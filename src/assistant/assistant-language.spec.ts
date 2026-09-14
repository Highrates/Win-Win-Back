import { describe, expect, it } from 'vitest';
import {
  assistantLanguageHint,
  messageHasHanScript,
} from './assistant-language';

describe('assistant-language', () => {
  it('детектит иероглифы', () => {
    expect(messageHasHanScript('现在有多少订单？')).toBe(true);
    expect(messageHasHanScript('Сколько заказов?')).toBe(false);
    expect(messageHasHanScript('hello')).toBe(false);
  });

  it('даёт хинт только для китайского', () => {
    expect(assistantLanguageHint('多少未读消息？')).toMatch(/简体中文/);
    expect(assistantLanguageHint('Сколько непрочитанных?')).toBeNull();
  });
});
