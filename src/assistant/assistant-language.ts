/** CJK Unified Ideographs + compatibility ideographs (enough to detect Chinese user messages). */
const HAN_SCRIPT_RE = /[\u3400-\u9FFF\uF900-\uFAFF]/;

export function messageHasHanScript(text: string): boolean {
  return HAN_SCRIPT_RE.test(text);
}

/** Extra system nudge when the latest user turn is Chinese. */
export function assistantLanguageHint(userMessage: string): string | null {
  if (!messageHasHanScript(userMessage)) return null;
  return 'Reply in Chinese (简体中文). Keep /admin/... links, IDs, and numbers as-is.';
}
