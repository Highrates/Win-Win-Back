/** Единая транслитерация slug (категории, товары, варианты). */

export { slugifyVariantLabel } from '@win-win/catalog-slug';

export const CYR_TO_LAT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

export function transliterateRu(input: string): string {
  return [...input.toLowerCase()].map((ch) => CYR_TO_LAT[ch] ?? ch).join('');
}

/** Slug для категорий и брендов (историческое имя `slugifyBase`). */
export function slugifyCategoryBase(name: string): string {
  const raw = transliterateRu(name)
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return raw || 'category';
}

export function slugifyProductBase(name: string): string {
  const raw = transliterateRu(name)
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return raw || 'product';
}

/** @deprecated используйте slugifyCategoryBase */
export const slugifyBase = slugifyCategoryBase;
