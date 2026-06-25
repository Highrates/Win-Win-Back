import { SOURCING_PRODUCT_NAME_MAX } from './limits';

/** Имя позиции в БД: явное name → для одного товара title заявки → «Товар N». */
export function resolveSourcingProductStoredName(params: {
  name?: string | null;
  requestTitle: string;
  productIndex: number;
  productCount: number;
}): string {
  const trimmed = params.name?.trim();
  if (trimmed) return trimmed.slice(0, SOURCING_PRODUCT_NAME_MAX);

  const title = params.requestTitle.trim();
  if (params.productCount === 1 && title) {
    return title.slice(0, SOURCING_PRODUCT_NAME_MAX);
  }

  return `Товар ${params.productIndex + 1}`;
}

/** UI/админка: пустое имя и legacy «—» → те же правила, что при сохранении в БД. */
export function resolveSourcingProductDisplayName(params: {
  name?: string | null;
  requestTitle: string;
  productIndex: number;
  productCount: number;
}): string {
  const trimmed = params.name?.trim();
  if (trimmed && trimmed !== '—') return trimmed;
  return resolveSourcingProductStoredName({
    name: '',
    requestTitle: params.requestTitle,
    productIndex: params.productIndex,
    productCount: params.productCount,
  });
}
