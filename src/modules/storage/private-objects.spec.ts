import { describe, expect, it } from 'vitest';
import { isPrivateObjectKey } from './private-objects';

describe('isPrivateObjectKey', () => {
  it('covers chat attachments and sourcing request files', () => {
    expect(isPrivateObjectKey('objects/chat/orders/o1/a.pdf')).toBe(true);
    expect(isPrivateObjectKey('/objects/chat/sourcing-requests/s1/b.png')).toBe(true);
    expect(isPrivateObjectKey('objects/sourcing-requests/s1/attachments/tz.docx')).toBe(true);
  });

  it('leaves public media alone', () => {
    expect(isPrivateObjectKey('objects/sourcing-requests/s1/items/i1/ref.jpg')).toBe(false);
    expect(isPrivateObjectKey('objects/product-qa/p1/a.jpg')).toBe(false);
    expect(isPrivateObjectKey('brands/cover/1.jpg')).toBe(false);
  });

  it('is not fooled by encoding, dot segments or letter case', () => {
    expect(isPrivateObjectKey('/Objects/Chat/orders/o1/a.pdf')).toBe(true);
    expect(isPrivateObjectKey('/objects/%63hat/orders/o1/a.pdf')).toBe(true);
    expect(isPrivateObjectKey('/brands/../objects/chat/orders/o1/a.pdf')).toBe(true);
    expect(isPrivateObjectKey('//objects//chat/orders/o1/a.pdf')).toBe(true);
    expect(isPrivateObjectKey('/objects/sourcing-requests/s1/items/../attachments/f.pdf')).toBe(true);
  });
});
