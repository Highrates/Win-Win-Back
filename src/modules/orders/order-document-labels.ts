import { fileExtension, filenameFromUrl } from '../storage/stored-file';

export const ORDER_DOCUMENT_LABELS: Record<string, string> = {
  invoice: 'Счёт',
  act: 'Акт',
  waybill: 'Накладная',
  contract: 'Договор',
  upd: 'УПД',
};

/** Заголовок документа заказа в списках: подпись вида, иначе имя файла из URL. */
export function orderDocumentTitle(kind: string, url: string): string {
  return ORDER_DOCUMENT_LABELS[kind.toLowerCase()] ?? filenameFromUrl(url);
}

/** Имя файла при скачивании: подпись вида + расширение из URL («Счёт.pdf»), иначе имя из URL. */
export function orderDocumentFilename(kind: string, url: string): string {
  const fromUrl = filenameFromUrl(url);
  const label = ORDER_DOCUMENT_LABELS[kind.toLowerCase()];
  if (!label) return fromUrl;
  const ext = fileExtension(fromUrl);
  return `${label}${ext ? `.${ext}` : ''}`;
}
