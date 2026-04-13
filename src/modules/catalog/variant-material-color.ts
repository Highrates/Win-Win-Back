import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Проверяет, что размер принадлежит товару, материал — размеру, цвет — материалу.
 * Вызывать при обновлении варианта, когда меняются FK размера/материала/цвета.
 */
export async function assertMaterialColorPairForProduct(
  prisma: PrismaService,
  productId: string,
  sizeOptionId: string,
  materialOptionId: string,
  colorOptionId: string,
): Promise<{ materialName: string; colorName: string }> {
  const sz = await prisma.productSizeOption.findFirst({
    where: { id: sizeOptionId, productId },
  });
  if (!sz) {
    throw new BadRequestException('Размер не относится к этому товару');
  }
  const mat = await prisma.productMaterialOption.findFirst({
    where: { id: materialOptionId, sizeOptionId },
  });
  const col = await prisma.productColorOption.findFirst({
    where: { id: colorOptionId, sizeOptionId },
  });
  const link = await prisma.productColorMaterial.findFirst({
    where: { colorOptionId, materialOptionId },
  });
  if (!mat || !col || !link) {
    throw new BadRequestException('Материал или цвет не относятся к этому размеру');
  }
  return { materialName: mat.name, colorName: col.name };
}
