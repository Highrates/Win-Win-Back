import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CartService {
  constructor(private prisma: PrismaService) {}

  async getOrCreateCart(userId: string) {
    return this.prisma.cart.upsert({
      where: { userId },
      create: { userId },
      update: {},
      include: {
        items: {
          include: {
            product: { include: { images: true, brand: true } },
            productVariant: {
              include: {
                variantProductImages: {
                  orderBy: { sortOrder: 'asc' },
                  include: { productImage: true },
                },
              },
            },
          },
        },
      },
    });
  }

  async addItem(userId: string, productVariantId: string, quantity = 1) {
    const variant = await this.prisma.productVariant.findFirst({
      where: {
        id: productVariantId,
        isActive: true,
        product: { isActive: true },
      },
      select: { id: true, productId: true },
    });
    if (!variant) {
      throw new NotFoundException('Вариант товара не найден или недоступен');
    }

    const cart = await this.prisma.cart.findUnique({ where: { userId } });
    if (!cart) {
      const newCart = await this.prisma.cart.create({
        data: {
          userId,
          items: {
            create: {
              productId: variant.productId,
              productVariantId: variant.id,
              quantity,
            },
          },
        },
        include: {
          items: { include: { product: true, productVariant: true } },
        },
      });
      return newCart;
    }
    const existing = await this.prisma.cartItem.findUnique({
      where: { cartId_productVariantId: { cartId: cart.id, productVariantId: variant.id } },
    });
    if (existing) {
      await this.prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: existing.quantity + quantity },
      });
    } else {
      await this.prisma.cartItem.create({
        data: {
          cartId: cart.id,
          productId: variant.productId,
          productVariantId: variant.id,
          quantity,
        },
      });
    }
    return this.getOrCreateCart(userId);
  }

  async updateItem(userId: string, productVariantId: string, quantity: number) {
    const cart = await this.prisma.cart.findUnique({ where: { userId } });
    if (!cart) return null;
    if (quantity <= 0) {
      await this.prisma.cartItem.deleteMany({
        where: { cartId: cart.id, productVariantId },
      });
    } else {
      await this.prisma.cartItem.upsert({
        where: {
          cartId_productVariantId: { cartId: cart.id, productVariantId },
        },
        create: {
          cartId: cart.id,
          productId: (
            await this.prisma.productVariant.findUniqueOrThrow({
              where: { id: productVariantId },
              select: { productId: true },
            })
          ).productId,
          productVariantId,
          quantity,
        },
        update: { quantity },
      });
    }
    return this.getOrCreateCart(userId);
  }

  async removeItem(userId: string, productVariantId: string) {
    const cart = await this.prisma.cart.findUnique({ where: { userId } });
    if (!cart) return null;
    await this.prisma.cartItem.deleteMany({
      where: { cartId: cart.id, productVariantId },
    });
    return this.getOrCreateCart(userId);
  }

  async clear(userId: string) {
    const cart = await this.prisma.cart.findUnique({ where: { userId } });
    if (!cart) return null;
    await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    return this.getOrCreateCart(userId);
  }
}
