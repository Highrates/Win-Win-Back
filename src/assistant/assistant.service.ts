import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StaffAccessService } from '../modules/staff/staff-access.service';
import {
  ASSISTANT_MAX_TOOL_ROUNDS,
  ASSISTANT_SYSTEM_PROMPT,
} from './assistant.constants';
import {
  assistantToolStatusMessage,
  dbHistoryToModelMessages,
  isAssistantUiHistoryMessage,
} from './assistant-history';
import { staffCanUseAssistantTool } from './assistant-tool-acl';
import { AssistantToolsService } from './assistant-tools.service';
import { GptunnelClient, type GptMessage, type GptUsage } from './gptunnel.client';

export type AssistantSseEvent =
  | { type: 'thread'; threadId: string }
  | { type: 'status'; message: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; threadId: string; content: string }
  | { type: 'error'; message: string };

function isAbortError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const name = (e as { name?: string }).name;
  return name === 'AbortError';
}

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gptunnel: GptunnelClient,
    private readonly tools: AssistantToolsService,
    private readonly staffAccess: StaffAccessService,
  ) {}

  async listThreads(staffId: string) {
    const rows = await this.prisma.assistantThread.findMany({
      where: { staffId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          where: { role: { in: ['user', 'assistant'] } },
          select: { content: true, role: true },
        },
      },
    });
    return {
      items: rows.map((t) => ({
        id: t.id,
        title: t.title || 'Диалог',
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        preview: t.messages[0]?.content?.slice(0, 120) ?? '',
      })),
    };
  }

  async getThread(staffId: string, threadId: string) {
    const thread = await this.prisma.assistantThread.findFirst({
      where: { id: threadId, staffId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          where: { role: { in: ['user', 'assistant'] } },
          select: {
            id: true,
            role: true,
            content: true,
            meta: true,
            createdAt: true,
          },
        },
      },
    });
    if (!thread) throw new NotFoundException('Диалог не найден');
    return {
      id: thread.id,
      title: thread.title,
      messages: thread.messages
        .filter((m) => isAssistantUiHistoryMessage(m))
        .map((m) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          createdAt: m.createdAt.toISOString(),
        })),
    };
  }

  async clearAllThreads(staffId: string) {
    const result = await this.prisma.assistantThread.deleteMany({
      where: { staffId },
    });
    return { deleted: result.count };
  }

  private async writeAudit(data: {
    staffId: string;
    threadId?: string | null;
    kind: string;
    toolName?: string | null;
    promptChars?: number | null;
    promptTokens?: number | null;
    completionTokens?: number | null;
    totalTokens?: number | null;
    model?: string | null;
    meta?: Prisma.InputJsonValue;
  }) {
    try {
      await this.prisma.assistantAuditEvent.create({
        data: {
          staffId: data.staffId,
          threadId: data.threadId ?? null,
          kind: data.kind,
          toolName: data.toolName ?? null,
          promptChars: data.promptChars ?? null,
          promptTokens: data.promptTokens ?? null,
          completionTokens: data.completionTokens ?? null,
          totalTokens: data.totalTokens ?? null,
          model: data.model ?? null,
          meta: data.meta ?? undefined,
        },
      });
    } catch (e) {
      this.logger.warn(
        `assistant audit failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async *chatStream(
    staffId: string,
    role: string,
    message: string,
    threadId?: string,
    signal?: AbortSignal,
  ): AsyncGenerator<AssistantSseEvent> {
    this.gptunnel.assertConfigured();
    if (signal?.aborted) return;

    if (role !== UserRole.ADMIN && role !== UserRole.MODERATOR) {
      throw new ForbiddenException('Admin only');
    }

    const ctx = await this.staffAccess.getStaffContext(
      staffId,
      role as UserRole,
    );
    if (!ctx) throw new ForbiddenException('Нет доступа');

    const acl = {
      sections: ctx.sections,
      isSuperAdmin: ctx.isSuperAdmin,
      staffId,
      staffRole: role as UserRole,
    };

    let thread =
      threadId != null && threadId.trim()
        ? await this.prisma.assistantThread.findFirst({
            where: { id: threadId.trim(), staffId },
          })
        : null;

    if (threadId?.trim() && !thread) {
      throw new ForbiddenException('Диалог не найден или чужой');
    }

    if (!thread) {
      const title = message.trim().slice(0, 80);
      thread = await this.prisma.assistantThread.create({
        data: { staffId, title },
      });
    }

    yield { type: 'thread', threadId: thread.id };

    const trimmed = message.trim();
    await this.prisma.assistantMessage.create({
      data: {
        threadId: thread.id,
        role: 'user',
        content: trimmed,
      },
    });

    await this.writeAudit({
      staffId,
      threadId: thread.id,
      kind: 'chat',
      promptChars: trimmed.length,
      model: this.gptunnel.model,
      meta: {
        maxTokens: this.gptunnel.maxTokens,
        toolCount: this.tools.listToolDefs(acl).length,
      },
    });

    if (signal?.aborted) return;

    const history = await this.prisma.assistantMessage.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: 'asc' },
      take: 80,
      select: { role: true, content: true, meta: true },
    });

    // Past tool JSON / stubs omitted — current-turn tools stay in-memory only.
    const messages: GptMessage[] = dbHistoryToModelMessages(
      ASSISTANT_SYSTEM_PROMPT,
      history,
    );

    const toolDefs = this.tools.listToolDefs(acl);
    let finalText = '';
    let usageAcc: GptUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };

    try {
      for (let round = 0; round < ASSISTANT_MAX_TOOL_ROUNDS; round++) {
        if (signal?.aborted) return;

        yield {
          type: 'status',
          message: round === 0 ? 'Думаю…' : 'Смотрю данные…',
        };

        let reply: GptMessage | null = null;
        let streamedText = '';

        for await (const event of this.gptunnel.streamChatCompletions({
          messages,
          tools: toolDefs,
          signal,
        })) {
          if (signal?.aborted) return;
          if (event.type === 'content') {
            streamedText += event.text;
            yield { type: 'delta', text: event.text };
          } else if (event.type === 'usage') {
            usageAcc = {
              promptTokens: usageAcc.promptTokens + event.usage.promptTokens,
              completionTokens:
                usageAcc.completionTokens + event.usage.completionTokens,
              totalTokens: usageAcc.totalTokens + event.usage.totalTokens,
            };
          } else {
            reply = event.message;
          }
        }

        if (!reply) {
          throw new Error('GPTunnel: пустой stream');
        }

        const toolCalls = reply.tool_calls ?? [];
        if (toolCalls.length > 0) {
          messages.push({
            role: 'assistant',
            content: reply.content ?? null,
            tool_calls: toolCalls,
          });
          await this.prisma.assistantMessage.create({
            data: {
              threadId: thread.id,
              role: 'assistant',
              content: reply.content ?? '',
              meta: { tool_calls: toolCalls } as Prisma.InputJsonValue,
            },
          });

          for (const call of toolCalls) {
            if (signal?.aborted) return;
            const name = call.function?.name || '';
            const args = call.function?.arguments || '{}';
            yield { type: 'status', message: assistantToolStatusMessage(name) };

            if (!staffCanUseAssistantTool(name, acl.sections, acl.isSuperAdmin)) {
              await this.writeAudit({
                staffId,
                threadId: thread.id,
                kind: 'deny_tool',
                toolName: name,
              });
              const denied = { error: 'Нет доступа к этому инструменту' };
              const content = JSON.stringify(denied);
              messages.push({
                role: 'tool',
                tool_call_id: call.id,
                content,
              });
              await this.prisma.assistantMessage.create({
                data: {
                  threadId: thread.id,
                  role: 'tool',
                  content,
                  meta: {
                    tool_call_id: call.id,
                    name,
                    denied: true,
                  } as Prisma.InputJsonValue,
                },
              });
              continue;
            }

            const result = await this.tools.execute(name, args, acl);
            await this.writeAudit({
              staffId,
              threadId: thread.id,
              kind: 'tool',
              toolName: name,
              meta: {
                ok: !(
                  result &&
                  typeof result === 'object' &&
                  'error' in (result as object)
                ),
              },
            });
            const content = JSON.stringify(result);
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content,
            });
            await this.prisma.assistantMessage.create({
              data: {
                threadId: thread.id,
                role: 'tool',
                content,
                meta: { tool_call_id: call.id, name } as Prisma.InputJsonValue,
              },
            });
          }
          continue;
        }

        finalText =
          (reply.content ?? streamedText).trim() || 'Нет ответа от модели.';
        break;
      }

      if (signal?.aborted) return;

      if (!finalText) {
        finalText =
          'Достигнут лимит шагов tools. Уточните вопрос или попробуйте ещё раз.';
        yield { type: 'delta', text: finalText };
      }

      await this.prisma.assistantMessage.create({
        data: {
          threadId: thread.id,
          role: 'assistant',
          content: finalText,
        },
      });
      await this.prisma.assistantThread.update({
        where: { id: thread.id },
        data: { updatedAt: new Date() },
      });

      if (usageAcc.totalTokens > 0) {
        await this.writeAudit({
          staffId,
          threadId: thread.id,
          kind: 'usage',
          promptTokens: usageAcc.promptTokens,
          completionTokens: usageAcc.completionTokens,
          totalTokens: usageAcc.totalTokens,
          model: this.gptunnel.model,
        });
      }

      yield { type: 'done', threadId: thread.id, content: finalText };
    } catch (e) {
      if (isAbortError(e) || signal?.aborted) return;
      const msg = e instanceof Error ? e.message : 'Ошибка ассистента';
      this.logger.error(msg);
      await this.writeAudit({
        staffId,
        threadId: thread.id,
        kind: 'error',
        meta: { message: msg.slice(0, 300) },
      });
      // User message already saved — client keeps it and can retry in same thread.
      yield { type: 'error', message: msg };
    }
  }
}
