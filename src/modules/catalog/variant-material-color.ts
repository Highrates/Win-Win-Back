import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Проверяет, что материал принадлежит товару, цвет — материалу.
 * Вызывать при обновлении варианта, когда меняются FK материала/цвета.
 */
export async function assertMaterialColorPairForProduct(
  prisma: PrismaService,
  productId: string,
  materialOptionId: string,
  colorOptionId: string,
): Promise<{ materialName: string; colorName: string }> {
  const mat = await prisma.productMaterialOption.findFirst({
    where: { id: materialOptionId, productId },
  });
  const col = await prisma.productColorOption.findFirst({
    where: { id: colorOptionId, materialOptionId },
  });
  if (!mat || !col) {
    throw new BadRequestException('Материал или цвет не относятся к этому товару');
  }
  return { materialName: mat.name, colorName: col.name };
}
