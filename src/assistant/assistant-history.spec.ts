import { describe, expect, it } from 'vitest';
import {
  assistantToolStatusMessage,
  dbHistoryToModelMessages,
  isAssistantUiHistoryMessage,
} from './assistant-history';

describe('assistantToolStatusMessage', () => {
  it('возвращает человеческие фразы', () => {
    expect(assistantToolStatusMessage('get_orders_dashboard')).toBe(
      'Смотрю сводку заказов…',
    );
    expect(assistantToolStatusMessage('list_orders')).toBe('Смотрю заказы…');
    expect(assistantToolStatusMessage('search_products')).toBe(
      'Ищу товары в каталоге…',
    );
    expect(assistantToolStatusMessage('get_sourcing_summary')).toBe(
      'Смотрю заявки на подбор…',
    );
    expect(assistantToolStatusMessage('get_qa_pending_summary')).toBe(
      'Смотрю очередь Q&A…',
    );
    expect(assistantToolStatusMessage('unknown_tool')).toBe('Смотрю данные…');
  });
});

describe('dbHistoryToModelMessages', () => {
  it('не отправляет tool JSON и stubs с tool_calls', () => {
    const messages = dbHistoryToModelMessages('SYS', [
      { role: 'user', content: 'Сколько заказов?', meta: null },
      {
        role: 'assistant',
        content: '',
        meta: {
          tool_calls: [
            {
              id: 'c1',
              type: 'function',
              function: { name: 'get_orders_dashboard', arguments: '{}' },
            },
          ],
        },
      },
      {
        role: 'tool',
        content: '{"new":12}',
        meta: { tool_call_id: 'c1', name: 'get_orders_dashboard' },
      },
      { role: 'assistant', content: 'Сегодня 12 новых заказов.', meta: null },
    ]);

    expect(messages).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'Сколько заказов?' },
      { role: 'assistant', content: 'Сегодня 12 новых заказов.' },
    ]);
    expect(JSON.stringify(messages)).not.toContain('"new":12');
  });
});

describe('isAssistantUiHistoryMessage', () => {
  it('фильтрует stubs и tool', () => {
    expect(
      isAssistantUiHistoryMessage({
        role: 'user',
        content: 'hi',
        meta: null,
      }),
    ).toBe(true);
    expect(
      isAssistantUiHistoryMessage({
        role: 'assistant',
        content: 'Ответ',
        meta: null,
      }),
    ).toBe(true);
    expect(
      isAssistantUiHistoryMessage({
        role: 'assistant',
        content: '',
        meta: { tool_calls: [{ id: '1' }] },
      }),
    ).toBe(false);
  });
});
