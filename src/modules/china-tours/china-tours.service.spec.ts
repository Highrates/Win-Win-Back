import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { ChinaToursService } from './china-tours.service';

describe('ChinaToursService', () => {
  const prisma = {
    chinaToursLanding: { upsert: vi.fn() },
    chinaTour: { findMany: vi.fn(), findFirst: vi.fn() },
    chinaTourApplication: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    chinaTourReview: { create: vi.fn() },
    user: { findUnique: vi.fn() },
  };

  const mail = { sendChinaTourApplicationStaff: vi.fn() };
  const config = { get: vi.fn(() => 'http://localhost:3000') };
  const orderChat = { getStaffNotifyEmailRecipients: vi.fn(async () => [] as string[]) };

  let service: ChinaToursService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ChinaToursService(
      prisma as never,
      mail as never,
      config as never,
      orderChat as never,
    );
  });

  describe('listPublished + featured', () => {
    it('отдаёт туры в порядке featuredTourIds', async () => {
      prisma.chinaToursLanding.upsert.mockResolvedValue({
        id: 'landing',
        featuredTourIds: ['t2', 't1'],
      });
      prisma.chinaTour.findMany.mockResolvedValue([
        {
          id: 't1',
          slug: 'one',
          title: 'One',
          cardText: null,
          startsAt: new Date('2026-01-01'),
          endsAt: new Date('2026-01-05'),
          seatsTotal: 10,
          seatsTaken: 2,
          images: [],
        },
        {
          id: 't2',
          slug: 'two',
          title: 'Two',
          cardText: null,
          startsAt: new Date('2026-02-01'),
          endsAt: new Date('2026-02-05'),
          seatsTotal: 8,
          seatsTaken: 0,
          images: [],
        },
      ]);

      const list = await service.listPublished();
      expect(list.map((t) => t.id)).toEqual(['t2', 't1']);
      expect(prisma.chinaTour.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isPublished: true,
            id: { in: ['t2', 't1'] },
          }),
        }),
      );
    });

    it('без featured не фильтрует по id', async () => {
      prisma.chinaToursLanding.upsert.mockResolvedValue({
        id: 'landing',
        featuredTourIds: null,
      });
      prisma.chinaTour.findMany.mockResolvedValue([]);
      await service.listPublished();
      expect(prisma.chinaTour.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isPublished: true },
        }),
      );
    });
  });

  describe('apply', () => {
    it('создаёт заявку', async () => {
      prisma.chinaTour.findFirst.mockResolvedValue({
        id: 'tour1',
        title: 'Tour',
        endsAt: new Date('2099-01-01'),
      });
      prisma.chinaTourApplication.findUnique.mockResolvedValue(null);
      prisma.chinaTourApplication.create.mockResolvedValue({
        id: 'app1',
        status: 'PENDING',
        comment: null,
        createdAt: new Date(),
      });

      const row = await service.apply('slug', 'user1', {});
      expect(row.id).toBe('app1');
      expect(prisma.chinaTourApplication.create).toHaveBeenCalled();
    });

    it('REJECTED → повторная заявка (update → PENDING)', async () => {
      prisma.chinaTour.findFirst.mockResolvedValue({
        id: 'tour1',
        title: 'Tour',
        endsAt: new Date('2099-01-01'),
      });
      prisma.chinaTourApplication.findUnique.mockResolvedValue({
        id: 'app1',
        status: 'REJECTED',
      });
      prisma.chinaTourApplication.update.mockResolvedValue({
        id: 'app1',
        status: 'PENDING',
        comment: 'again',
        createdAt: new Date(),
      });

      const row = await service.apply('slug', 'user1', { comment: 'again' });
      expect(row.status).toBe('PENDING');
      expect(prisma.chinaTourApplication.update).toHaveBeenCalled();
      expect(prisma.chinaTourApplication.create).not.toHaveBeenCalled();
    });

    it('404 если тур не найден', async () => {
      prisma.chinaTour.findFirst.mockResolvedValue(null);
      await expect(service.apply('missing', 'user1', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('Conflict при PENDING/ACCEPTED', async () => {
      prisma.chinaTour.findFirst.mockResolvedValue({
        id: 'tour1',
        title: 'Tour',
        endsAt: new Date('2099-01-01'),
      });
      prisma.chinaTourApplication.findUnique.mockResolvedValue({
        id: 'app1',
        status: 'PENDING',
      });
      await expect(service.apply('slug', 'user1', {})).rejects.toBeInstanceOf(ConflictException);
    });

    it('Conflict при гонке create (P2002)', async () => {
      prisma.chinaTour.findFirst.mockResolvedValue({
        id: 'tour1',
        title: 'Tour',
        endsAt: new Date('2099-01-01'),
      });
      prisma.chinaTourApplication.findUnique.mockResolvedValue(null);
      const err = new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      });
      prisma.chinaTourApplication.create.mockRejectedValue(err);
      await expect(service.apply('slug', 'user1', {})).rejects.toBeInstanceOf(ConflictException);
    });

    it('BadRequest если тур уже завершён', async () => {
      prisma.chinaTour.findFirst.mockResolvedValue({
        id: 'tour1',
        title: 'Tour',
        endsAt: new Date('2020-01-01'),
      });
      await expect(service.apply('slug', 'user1', {})).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.chinaTourApplication.create).not.toHaveBeenCalled();
    });
  });

  describe('listMyApplications', () => {
    it('отдаёт seats, cardPrimaryUrl и canReview для ACCEPTED past', async () => {
      prisma.chinaTourApplication.findMany = vi.fn().mockResolvedValue([
        {
          id: 'a1',
          status: 'ACCEPTED',
          comment: 'hi',
          createdAt: new Date('2026-01-10'),
          tour: {
            id: 't1',
            slug: 'past-tour',
            title: 'Past',
            startsAt: new Date('2025-01-01'),
            endsAt: new Date('2025-01-10'),
            isPublished: true,
            seatsTotal: 10,
            seatsTaken: 3,
            images: [{ url: '/uploads/card.jpg' }],
          },
        },
        {
          id: 'a2',
          status: 'PENDING',
          comment: null,
          createdAt: new Date('2026-02-01'),
          tour: {
            id: 't2',
            slug: 'future',
            title: 'Future',
            startsAt: new Date('2099-01-01'),
            endsAt: new Date('2099-01-10'),
            isPublished: false,
            seatsTotal: 8,
            seatsTaken: 0,
            images: [],
          },
        },
      ]);

      const list = await service.listMyApplications('user1');
      expect(list).toHaveLength(2);
      expect(list[0]).toMatchObject({
        id: 'a1',
        canReview: true,
        tour: {
          slug: 'past-tour',
          seatsTotal: 10,
          seatsTaken: 3,
          cardPrimaryUrl: '/uploads/card.jpg',
          isPublished: true,
        },
      });
      expect(list[1]).toMatchObject({
        id: 'a2',
        canReview: false,
        tour: {
          cardPrimaryUrl: null,
          isPublished: false,
          seatsTaken: 0,
        },
      });
    });
  });

  describe('createReview', () => {
    it('только ACCEPTED участник после endsAt', async () => {
      prisma.chinaTour.findFirst.mockResolvedValue({
        id: 'tour1',
        endsAt: new Date('2020-01-01'),
      });
      prisma.chinaTourApplication.findUnique.mockResolvedValue({ status: 'ACCEPTED' });
      prisma.chinaTourReview.create.mockResolvedValue({
        id: 'r1',
        status: 'PENDING',
        body: 'ok',
        rating: 5,
        createdAt: new Date(),
      });

      const row = await service.createReview('slug', 'user1', { body: 'ok', rating: 5 });
      expect(row.id).toBe('r1');
    });

    it('Forbidden без ACCEPTED заявки', async () => {
      prisma.chinaTour.findFirst.mockResolvedValue({
        id: 'tour1',
        endsAt: new Date('2020-01-01'),
      });
      prisma.chinaTourApplication.findUnique.mockResolvedValue({ status: 'PENDING' });
      await expect(
        service.createReview('slug', 'user1', { body: 'ok' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
