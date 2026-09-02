import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ASSISTANT_DEFAULT_MAX_TOKENS } from './assistant.constants';

export type GptMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: GptToolCall[];
  tool_call_id?: string;
  name?: string;
};

export type GptToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type GptToolDef = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type GptUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type GptStreamEvent =
  | { type: 'content'; text: string }
  | { type: 'usage'; usage: GptUsage }
  | { type: 'message'; message: GptMessage };

type ChatCompletionResponse = {
  choices?: Array<{
    message?: GptMessage;
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string };
};

type StreamDeltaPayload = {
  choices?: Array<{
    delta?: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string };
};

function parseUsage(
  raw: StreamDeltaPayload['usage'] | ChatCompletionResponse['usage'],
): GptUsage | null {
  if (!raw) return null;
  const promptTokens = Number(raw.prompt_tokens ?? 0);
  const completionTokens = Number(raw.completion_tokens ?? 0);
  const totalTokens = Number(
    raw.total_tokens ?? promptTokens + completionTokens,
  );
  if (
    !Number.isFinite(promptTokens) &&
    !Number.isFinite(completionTokens) &&
    !Number.isFinite(totalTokens)
  ) {
    return null;
  }
  return {
    promptTokens: Math.max(0, Math.trunc(promptTokens) || 0),
    completionTokens: Math.max(0, Math.trunc(completionTokens) || 0),
    totalTokens: Math.max(0, Math.trunc(totalTokens) || 0),
  };
}

@Injectable()
export class GptunnelClient {
  private readonly logger = new Logger(GptunnelClient.name);

  constructor(private readonly config: ConfigService) {}

  get model(): string {
    return this.config.get<string>('ASSISTANT_MODEL')?.trim() || 'gpt-4.1-mini';
  }

  get maxTokens(): number {
    const raw = this.config.get<string>('ASSISTANT_MAX_TOKENS')?.trim();
    const n = raw ? Number(raw) : NaN;
    if (!Number.isFinite(n) || n < 64) return ASSISTANT_DEFAULT_MAX_TOKENS;
    return Math.min(16_384, Math.trunc(n));
  }

  private get apiKey(): string {
    return this.config.get<string>('GPTUNNEL_API_KEY')?.trim() || '';
  }

  private get baseUrl(): string {
    const raw =
      this.config.get<string>('GPTUNNEL_BASE_URL')?.trim() || 'https://gptunnel.ru/v1';
    return raw.replace(/\/+$/, '');
  }

  assertConfigured() {
    if (!this.apiKey) {
      throw new ServiceUnavailableException(
        'Ассистент не настроен: задайте GPTUNNEL_API_KEY на сервере',
      );
    }
  }

  private buildBody(opts: {
    messages: GptMessage[];
    tools?: GptToolDef[];
    temperature?: number;
    stream: boolean;
  }): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.2,
      max_tokens: this.maxTokens,
      obfuscate: true,
      stream: opts.stream,
    };
    if (opts.stream) {
      body.stream_options = { include_usage: true };
    }
    if (opts.tools?.length) {
      body.tools = opts.tools;
      body.tool_choice = 'auto';
    }
    return body;
  }

  async chatCompletions(opts: {
    messages: GptMessage[];
    tools?: GptToolDef[];
    temperature?: number;
    signal?: AbortSignal;
  }): Promise<{ message: GptMessage; usage: GptUsage | null }> {
    this.assertConfigured();

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(this.buildBody({ ...opts, stream: false })),
      signal: opts.signal,
    });

    const text = await res.text();
    let json: ChatCompletionResponse;
    try {
      json = JSON.parse(text) as ChatCompletionResponse;
    } catch {
      this.logger.error(`GPTunnel non-JSON ${res.status}: ${text.slice(0, 300)}`);
      throw new ServiceUnavailableException('GPTunnel вернул некорректный ответ');
    }

    if (!res.ok) {
      const msg = json.error?.message || text.slice(0, 200) || `HTTP ${res.status}`;
      this.logger.error(`GPTunnel error ${res.status}: ${msg}`);
      throw new ServiceUnavailableException(`GPTunnel: ${msg}`);
    }

    const message = json.choices?.[0]?.message;
    if (!message) {
      throw new ServiceUnavailableException('GPTunnel: пустой ответ модели');
    }
    return { message, usage: parseUsage(json.usage) };
  }

  /** Real token stream from GPTunnel (OpenAI SSE). Yields content deltas, usage, then final message. */
  async *streamChatCompletions(opts: {
    messages: GptMessage[];
    tools?: GptToolDef[];
    temperature?: number;
    signal?: AbortSignal;
  }): AsyncGenerator<GptStreamEvent> {
    this.assertConfigured();

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: this.apiKey,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(this.buildBody({ ...opts, stream: true })),
      signal: opts.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      let msg = text.slice(0, 200) || `HTTP ${res.status}`;
      try {
        const json = JSON.parse(text) as ChatCompletionResponse;
        if (json.error?.message) msg = json.error.message;
      } catch {
        /* keep msg */
      }
      this.logger.error(`GPTunnel stream error ${res.status}: ${msg}`);
      throw new ServiceUnavailableException(`GPTunnel: ${msg}`);
    }

    if (!res.body) {
      throw new ServiceUnavailableException('GPTunnel: пустой stream body');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    const toolAcc = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();

    const flushLine = function* (
      line: string,
    ): Generator<GptStreamEvent, void, undefined> {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) return;
      if (!trimmed.startsWith('data:')) return;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') return;

      let json: StreamDeltaPayload;
      try {
        json = JSON.parse(data) as StreamDeltaPayload;
      } catch {
        return;
      }
      if (json.error?.message) {
        throw new ServiceUnavailableException(`GPTunnel: ${json.error.message}`);
      }

      const usage = parseUsage(json.usage);
      if (usage) {
        yield { type: 'usage', usage };
      }

      const delta = json.choices?.[0]?.delta;
      if (!delta) return;

      if (typeof delta.content === 'string' && delta.content.length > 0) {
        content += delta.content;
        yield { type: 'content', text: delta.content };
      }

      if (delta.tool_calls?.length) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          const cur = toolAcc.get(idx) ?? { id: '', name: '', arguments: '' };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (typeof tc.function?.arguments === 'string') {
            cur.arguments += tc.function.arguments;
          }
          toolAcc.set(idx, cur);
        }
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split(/\r?\n/);
        buffer = parts.pop() ?? '';
        for (const line of parts) {
          yield* flushLine(line);
        }
      }
      if (buffer.trim()) {
        yield* flushLine(buffer);
      }
    } finally {
      reader.releaseLock();
    }

    const tool_calls: GptToolCall[] = [...toolAcc.entries()]
      .sort((a, b) => a[0] - b[0])
      .filter(([, t]) => t.id && t.name)
      .map(([, t]) => ({
        id: t.id,
        type: 'function',
        function: { name: t.name, arguments: t.arguments || '{}' },
      }));

    yield {
      type: 'message',
      message: {
        role: 'assistant',
        content: content.length ? content : null,
        ...(tool_calls.length ? { tool_calls } : {}),
      },
    };
  }
}
