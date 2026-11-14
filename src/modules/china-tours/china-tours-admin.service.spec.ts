import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChinaToursAdminService } from './china-tours-admin.service';

describe('ChinaToursAdminService', () => {
  const prisma = {
    chinaToursLanding: { upsert: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    chinaTour: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      aggregate: vi.fn(),
    },
    $transaction: vi.fn(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: typeof prisma) => Promise<unknown>)(prisma);
      }
      return arg;
    }),
  };

  let service: ChinaToursAdminService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: typeof prisma) => Promise<unknown>)(prisma);
      }
      return arg;
    });
    service = new ChinaToursAdminService(prisma as never);
    prisma.chinaToursLanding.upsert.mockResolvedValue({ id: 'landing' });
    prisma.chinaToursLanding.findUnique.mockResolvedValue({ featuredTourIds: [] });
  });

  describe('seats', () => {
    it('createTour: seatsTaken > seatsTotal → BadRequest', async () => {
      await expect(
        service.createTour({
          title: 'T',
          startsAt: '2026-01-01T00:00:00.000Z',
          endsAt: '2026-01-05T00:00:00.000Z',
          seatsTotal: 5,
          seatsTaken: 6,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('updateTour: seatsTaken > seatsTotal → BadRequest', async () => {
      prisma.chinaTour.findUnique.mockResolvedValue({
        id: 't1',
        slug: 't',
        startsAt: new Date('2026-01-01'),
        endsAt: new Date('2026-01-05'),
        seatsTotal: 10,
        seatsTaken: 2,
        isPublished: false,
        publishedAt: null,
      });
      await expect(
        service.updateTour('t1', { seatsTotal: 3, seatsTaken: 5 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('featuredTourIds prune', () => {
    it('deleteTour убирает id из featured', async () => {
      prisma.chinaTour.findUnique.mockResolvedValue({ id: 't1' });
      prisma.chinaToursLanding.findUnique.mockResolvedValue({
        featuredTourIds: ['t1', 't2'],
      });
      prisma.chinaTour.delete.mockResolvedValue({});

      await service.deleteTour('t1');
      expect(prisma.chinaToursLanding.update).toHaveBeenCalledWith({
        where: { id: 'landing' },
        data: { featuredTourIds: ['t2'] },
      });
      expect(prisma.chinaTour.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
    });

    it('unpublish убирает id из featured', async () => {
      prisma.chinaTour.findUnique
        .mockResolvedValueOnce({
          id: 't1',
          slug: 't',
          startsAt: new Date('2026-01-01'),
          endsAt: new Date('2026-01-05'),
          seatsTotal: 10,
          seatsTaken: 2,
          isPublished: true,
          publishedAt: new Date(),
        })
        .mockResolvedValueOnce({
          id: 't1',
          slug: 't',
          title: 'T',
          cardText: null,
          startsAt: new Date('2026-01-01'),
          endsAt: new Date('2026-01-05'),
          seatsTotal: 10,
          seatsTaken: 2,
          isPublished: false,
          publishedAt: null,
          sortOrder: 0,
          days: [],
          images: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      prisma.chinaToursLanding.findUnique.mockResolvedValue({
        featuredTourIds: ['t1', 't2'],
      });
      prisma.chinaTour.update.mockResolvedValue({});

      await service.updateTour('t1', { isPublished: false });
      expect(prisma.chinaToursLanding.update).toHaveBeenCalledWith({
        where: { id: 'landing' },
        data: { featuredTourIds: ['t2'] },
      });
    });
  });

  describe('reorderTours', () => {
    it('требует полный список id', async () => {
      prisma.chinaTour.count.mockResolvedValue(2);
      await expect(service.reorderTours(['only-one'])).rejects.toBeInstanceOf(BadRequestException);
    });

    it('отклоняет неизвестные id', async () => {
      prisma.chinaTour.count.mockResolvedValue(2);
      prisma.chinaTour.findMany.mockResolvedValue([{ id: 'a' }]);
      await expect(service.reorderTours(['a', 'ghost'])).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('обновляет sortOrder по порядку', async () => {
      prisma.chinaTour.count.mockResolvedValue(2);
      prisma.chinaTour.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
      prisma.$transaction.mockResolvedValue([]);
      prisma.chinaTour.update.mockResolvedValue({});

      await service.reorderTours(['b', 'a']);
      expect(prisma.$transaction).toHaveBeenCalled();
      const ops = prisma.$transaction.mock.calls[0]![0] as unknown[];
      expect(ops).toHaveLength(2);
    });
  });
});
