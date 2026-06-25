/** Имя позиции в БД: явное name → для одного товара title заявки → «Товар N». */
export declare function resolveSourcingProductStoredName(params: {
    name?: string | null;
    requestTitle: string;
    productIndex: number;
    productCount: number;
}): string;
/** UI/админка: пустое имя и legacy «—» → те же правила, что при сохранении в БД. */
export declare function resolveSourcingProductDisplayName(params: {
    name?: string | null;
    requestTitle: string;
    productIndex: number;
    productCount: number;
}): string;
