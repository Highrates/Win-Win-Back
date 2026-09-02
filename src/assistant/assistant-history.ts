import type { GptMessage, GptToolCall } from './gptunnel.client';

export type AssistantDbMessage = {
  role: string;
  content: string;
  meta: unknown;
};

/** Human-readable status while a tool runs (never raw tool name). */
export function assistantToolStatusMessage(toolName: string): string {
  switch (toolName) {
    case 'get_dashboard_overview':
    case 'get_orders_dashboard':
      return 'Смотрю сводку заказов…';
    case 'list_orders':
      return 'Смотрю заказы…';
    case 'search_products':
      return 'Ищу товары в каталоге…';
    case 'get_sourcing_summary':
      return 'Смотрю заявки на подбор…';
    case 'get_qa_pending_summary':
      return 'Смотрю очередь Q&A…';
    case 'get_signup_summary':
      return 'Считаю регистрации…';
    case 'get_partner_applications_pending':
      return 'Смотрю заявки партнёров…';
    case 'list_oos_variants':
      return 'Проверяю товары без наличия…';
    case 'sales_timeseries':
      return 'Строю динамику продаж по дням…';
    case 'compare_periods':
      return 'Сравниваю периоды…';
    case 'top_products':
      return 'Считаю топ товаров…';
    case 'funnel_lite':
      return 'Смотрю воронку статусов заказов…';
    case 'content_gaps':
      return 'Ищу пробелы в контенте…';
    default:
      return 'Смотрю данные…';
  }
}

function metaToolCalls(meta: unknown): GptToolCall[] | null {
  if (!meta || typeof meta !== 'object') return null;
  const toolCalls = (meta as { tool_calls?: unknown }).tool_calls;
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return null;
  return toolCalls as GptToolCall[];
}

/** UI / resume: only user turns and final assistant replies (no tool stubs). */
export function isAssistantUiHistoryMessage(m: AssistantDbMessage): boolean {
  if (m.role === 'user') return true;
  if (m.role !== 'assistant') return false;
  if (metaToolCalls(m.meta)) return false;
  return m.content.trim().length > 0;
}

/**
 * Build model context from DB history without past tool JSON / tool_call stubs.
 * Current-turn tools are appended in-memory during the agent loop.
 */
export function dbHistoryToModelMessages(
  systemPrompt: string,
  history: readonly AssistantDbMessage[],
): GptMessage[] {
  const messages: GptMessage[] = [{ role: 'system', content: systemPrompt }];
  for (const m of history) {
    if (m.role === 'user') {
      messages.push({ role: 'user', content: m.content });
      continue;
    }
    if (m.role === 'assistant') {
      if (metaToolCalls(m.meta)) continue;
      const text = m.content.trim();
      if (!text) continue;
      messages.push({ role: 'assistant', content: text });
    }
    // skip role=tool and anything else
  }
  return messages;
}
