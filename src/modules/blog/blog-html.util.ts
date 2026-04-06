/** `export =` из пакета; default import без esModuleInterop даёт undefined в Nest (CJS). */
import DOMPurify = require('isomorphic-dompurify');

const SANITIZE = {
  ALLOWED_TAGS: [
    'p',
    'br',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'h1',
    'h2',
    'h3',
    'h4',
    'ul',
    'ol',
    'li',
    'a',
    'img',
    'blockquote',
    'div',
    'span',
    'figure',
    'figcaption',
    'video',
    'source',
  ],
  ALLOWED_ATTR: [
    'href',
    'src',
    'alt',
    'title',
    'class',
    'width',
    'height',
    'controls',
    'type',
    'target',
    'rel',
    'loading',
  ],
  ALLOW_DATA_ATTR: false,
};

/**
 * Публичный вывод HTML из RichBlock: без скриптов, iframe, on* и прочего.
 */
export function sanitizeBlogPostBodyHtml(html: string): string {
  return DOMPurify.sanitize(html ?? '', SANITIZE);
}

/** URL из img / video / source[src] в HTML редактора. */
export function extractMediaUrlsFromRichHtml(html: string | null | undefined): string[] {
  if (!html?.trim()) return [];
  const urls = new Set<string>();
  const re = /<(img|video|source)\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const u = (m[2] ?? m[3] ?? m[4] ?? '').trim();
    if (u) urls.add(u);
  }
  return [...urls];
}
