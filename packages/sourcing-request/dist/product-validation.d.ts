export type SourcingProductFilledInput = {
    name?: string | null;
    description?: string | null;
    productLink?: string | null;
    /** Число референсов (keys на бэке, images на фронте). */
    referenceCount?: number;
};
export declare function isProductMinimallyFilled(input: SourcingProductFilledInput): boolean;
export declare function isSoftValidProductLink(value: string | undefined | null): boolean;
