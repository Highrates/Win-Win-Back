import {
  BadRequestException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ProductQaAuthorRole, ProductQaMessageStatus, UserRole } from '@prisma/client';
import express from 'express';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { ProductQaAdminController } from './product-qa-admin.controller';
import { ProductQaPublicController } from './product-qa-public.controller';
import type { ProductQaService } from './product-qa.service';

const sampleMessage = {
  id: 'm1',
  threadId: 't1',
  topicSlug: 'general',
  topicTitle: 'Общие вопросы',
  authorUserId: 'u1',
  authorRole: ProductQaAuthorRole.USER,
  authorLabel: 'Ann',
  authorAvatarUrl: null,
  body: 'Какой размер?',
  productVariantId: null,
  variantLabel: null,
  status: ProductQaMessageStatus.VISIBLE,
  attachments: [],
  createdAt: '2026-08-09T10:00:00.000Z',
};

const sampleCorrespondenceMessage = {
  id: 'cm1',
  correspondenceId: 'corr1',
  authorUserId: 'u1',
  authorRole: ProductQaAuthorRole.USER,
  authorLabel: 'Ann',
  authorAvatarUrl: null,
  body: 'Какой размер?',
  productVariantId: null,
  variantLabel: null,
  publishedQaMessageId: null,
  isPublishedToStorefront: false,
  attachments: [],
  createdAt: '2026-08-09T10:00:00.000Z',
};

/** Express-shim HTTP-тесты контроллеров (не полноценный Nest e2e). */
function createProductQaHttpApp(
  qa: ProductQaService,
  getUser: () => JwtPayload | null,
  correspondence: { postBySlug: ReturnType<typeof vi.fn> },
): NestExpressApplication {
  const jwt = { verify: vi.fn() } as unknown as JwtService;
  const publicController = new ProductQaPublicController(qa, jwt, correspondence as never);
  const adminController = new ProductQaAdminController(qa);
  const validationPipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  });

  const server = express();
  server.use(express.json());

  async function runValidated<T>(
    metatype: new () => T,
    body: unknown,
  ): Promise<T> {
    return validationPipe.transform(body, {
      type: 'body',
      metatype,
    }) as Promise<T>;
  }

  server.get('/api/v1/catalog/products/:slug/qa/meta', async (req, res, next) => {
    try {
      res.json(await publicController.meta(req.params.slug));
    } catch (e) {
      next(e);
    }
  });

  server.get('/api/v1/catalog/products/:slug/qa/messages', async (req, res, next) => {
    try {
      const auth = req.headers.authorization;
      res.json(
        await publicController.messages(
          req.params.slug,
          typeof auth === 'string' ? auth : undefined,
          req.query.limit as string | undefined,
          req.query.before as string | undefined,
          req.query.cursor as string | undefined,
          req.query.topic as string | undefined,
        ),
      );
    } catch (e) {
      next(e);
    }
  });

  server.post('/api/v1/catalog/products/:slug/qa/messages', async (req, res, next) => {
    try {
      const user = getUser();
      if (!user) throw new UnauthorizedException();
      const { PostProductQaMessageDto } = await import('./dto/product-qa.dto');
      const dto = await runValidated(PostProductQaMessageDto, req.body);
      res.status(201).json(await publicController.post(user, req.params.slug, dto));
    } catch (e) {
      next(e);
    }
  });

  server.patch('/api/v1/catalog/products/:slug/qa/messages/:messageId', async (req, res, next) => {
    try {
      const user = getUser();
      if (!user) throw new UnauthorizedException();
      const { EditProductQaMessageBodyDto } = await import('./dto/product-qa.dto');
      const dto = await runValidated(EditProductQaMessageBodyDto, req.body);
      res.json(
        await publicController.patchBody(user, req.params.slug, req.params.messageId, dto),
      );
    } catch (e) {
      next(e);
    }
  });

  server.get('/api/v1/catalog/admin/products/:id/qa/messages', async (req, res, next) => {
    try {
      const user = getUser();
      if (!user) throw new UnauthorizedException();
      res.json(
        await adminController.messages(
          user,
          req.params.id,
          req.query.limit as string | undefined,
          req.query.before as string | undefined,
          req.query.topic as string | undefined,
          req.query.status as string | undefined,
        ),
      );
    } catch (e) {
      next(e);
    }
  });

  server.post('/api/v1/catalog/admin/products/:id/qa/messages', async (req, res, next) => {
    try {
      if (!getUser()) throw new UnauthorizedException();
      await adminController.post();
    } catch (e) {
      next(e);
    }
  });

  server.post(
    '/api/v1/catalog/admin/products/:id/qa/messages/:messageId/approve',
    async (req, res, next) => {
      try {
        const user = getUser();
        if (!user) throw new UnauthorizedException();
        res.status(201).json(
          await adminController.approvePending(user, req.params.id, req.params.messageId),
        );
      } catch (e) {
        next(e);
      }
    },
  );

  server.post(
    '/api/v1/catalog/admin/products/:id/qa/messages/:messageId/reject',
    async (req, res, next) => {
      try {
        const user = getUser();
        if (!user) throw new UnauthorizedException();
        res.status(201).json(
          await adminController.rejectPending(user, req.params.id, req.params.messageId),
        );
      } catch (e) {
        next(e);
      }
    },
  );

  server.get('/api/v1/catalog/admin/qa/unread-summary', async (req, res, next) => {
    try {
      const user = getUser();
      if (!user) throw new UnauthorizedException();
      res.json(await adminController.qaUnreadSummary(user));
    } catch (e) {
      next(e);
    }
  });

  server.get('/api/v1/catalog/admin/qa/pending-summary', async (req, res, next) => {
    try {
      const user = getUser();
      if (!user) throw new UnauthorizedException();
      res.json(await adminController.qaPendingSummary(user));
    } catch (e) {
      next(e);
    }
  });

  server.get('/api/v1/catalog/admin/qa/chat-products', async (req, res, next) => {
    try {
      const user = getUser();
      if (!user) throw new UnauthorizedException();
      res.json(
        await adminController.qaChatProducts(
          user,
          req.query.limit as string | undefined,
          req.query.cursor as string | undefined,
        ),
      );
    } catch (e) {
      next(e);
    }
  });

  server.patch('/api/v1/catalog/admin/products/:id/qa/messages/:messageId', async (req, res, next) => {
    try {
      const user = getUser();
      if (!user) throw new UnauthorizedException();
      const { PatchProductQaMessageDto } = await import('./dto/product-qa.dto');
      const dto = await runValidated(PatchProductQaMessageDto, req.body);
      res.json(
        await adminController.patchMessage(user, req.params.id, req.params.messageId, dto),
      );
    } catch (e) {
      next(e);
    }
  });

  server.post(
    '/api/v1/catalog/admin/products/:id/qa/messages/:messageId/delete',
    async (req, res, next) => {
      try {
        const user = getUser();
        if (!user) throw new UnauthorizedException();
        res.status(201).json(await adminController.softDelete(user, req.params.id, req.params.messageId));
      } catch (e) {
        next(e);
      }
    },
  );

  server.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (err instanceof UnauthorizedException) {
        res.status(401).json(err.getResponse());
        return;
      }
      if (err instanceof BadRequestException) {
        res.status(400).json(err.getResponse());
        return;
      }
      if (err && typeof err === 'object' && 'getStatus' in err && typeof err.getStatus === 'function') {
        const status = err.getStatus();
        res.status(status).json(
          'getResponse' in err && typeof err.getResponse === 'function'
            ? err.getResponse()
            : { message: String(err) },
        );
        return;
      }
      res.status(500).json({ message: 'Internal Server Error' });
    },
  );

  return { getHttpServer: () => server } as NestExpressApplication;
}

describe('Product QA HTTP (Express shim)', () => {
  let app: NestExpressApplication;
  let qa: {
    getMetaBySlug: ReturnType<typeof vi.fn>;
    listTopicsBySlug: ReturnType<typeof vi.fn>;
    listMessagesBySlug: ReturnType<typeof vi.fn>;
    listMessagesForProductAsStaff: ReturnType<typeof vi.fn>;
    postMessageBySlug: ReturnType<typeof vi.fn>;
    postMessageForProduct: ReturnType<typeof vi.fn>;
    setMessageStatus: ReturnType<typeof vi.fn>;
    approvePendingMessage: ReturnType<typeof vi.fn>;
    rejectPendingMessage: ReturnType<typeof vi.fn>;
    getStaffQaUnreadSummary: ReturnType<typeof vi.fn>;
    getStaffQaPendingSummary: ReturnType<typeof vi.fn>;
    getStaffQaChatProducts: ReturnType<typeof vi.fn>;
  };

  let correspondence: {
    postBySlug: ReturnType<typeof vi.fn>;
  };

  let currentUser: JwtPayload | null = null;

  beforeEach(() => {
    currentUser = null;
    correspondence = {
      postBySlug: vi.fn(),
    };
    qa = {
      getMetaBySlug: vi.fn(),
      listTopicsBySlug: vi.fn(),
      listMessagesBySlug: vi.fn(),
      listMessagesForProductAsStaff: vi.fn(),
      postMessageBySlug: vi.fn(),
      postMessageForProduct: vi.fn(),
      setMessageStatus: vi.fn(),
      approvePendingMessage: vi.fn(),
      rejectPendingMessage: vi.fn(),
      getStaffQaUnreadSummary: vi.fn(),
      getStaffQaPendingSummary: vi.fn(),
      getStaffQaChatProducts: vi.fn(),
    };
    app = createProductQaHttpApp(
      qa as unknown as ProductQaService,
      () => currentUser,
      correspondence,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /catalog/products/:slug/qa/meta', () => {
    it('returns meta without auth', async () => {
      qa.getMetaBySlug.mockResolvedValue({
        threadId: 't1',
        messageCount: 3,
        topics: [{ id: 't1', slug: 'general', title: 'Общие вопросы', messageCount: 3, isDefault: true, sortOrder: 0 }],
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/catalog/products/chair/qa/meta')
        .expect(200);

      expect(res.body).toEqual({
        threadId: 't1',
        messageCount: 3,
        topics: [{ id: 't1', slug: 'general', title: 'Общие вопросы', messageCount: 3, isDefault: true, sortOrder: 0 }],
      });
      expect(qa.getMetaBySlug).toHaveBeenCalledWith('chair');
    });
  });

  describe('GET /catalog/products/:slug/qa/messages', () => {
    it('returns public message list', async () => {
      qa.listMessagesBySlug.mockResolvedValue({
        threadId: 't1',
        messages: [sampleMessage],
        hasOlder: false,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/catalog/products/chair/qa/messages')
        .query({ limit: '10' })
        .expect(200);

      expect(res.body.messages).toHaveLength(1);
      expect(res.body.messages[0].body).toBe('Какой размер?');
      expect(qa.listMessagesBySlug).toHaveBeenCalledWith('chair', {
        limit: 10,
        beforeMessageId: undefined,
        topicSlug: undefined,
        viewerUserId: undefined,
      });
    });

    it('rejects conflicting before and cursor', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/catalog/products/chair/qa/messages')
        .query({ before: 'm-old', cursor: 'm-other' })
        .expect(400);
    });

    it('rejects non-numeric limit', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/catalog/products/chair/qa/messages')
        .query({ limit: 'abc' })
        .expect(400);
    });
  });

  describe('POST /catalog/products/:slug/qa/messages', () => {
    it('returns 401 without JWT', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/catalog/products/chair/qa/messages')
        .send({ body: 'Вопрос' })
        .expect(401);
    });

    it('creates message for authenticated user via correspondence', async () => {
      currentUser = { sub: 'u1', role: UserRole.USER, email: 'u@test.com' };
      correspondence.postBySlug.mockResolvedValue(sampleCorrespondenceMessage);

      const res = await request(app.getHttpServer())
        .post('/api/v1/catalog/products/chair/qa/messages')
        .send({ body: 'Какой размер?' })
        .expect(201);

      expect(res.body.id).toBe('cm1');
      expect(correspondence.postBySlug).toHaveBeenCalledWith('chair', 'u1', UserRole.USER, {
        body: 'Какой размер?',
      });
    });

    it('accepts empty body at HTTP layer (service validates content)', async () => {
      currentUser = { sub: 'u1', role: UserRole.USER, email: 'u@test.com' };
      correspondence.postBySlug.mockRejectedValue(new BadRequestException('Пустое сообщение'));

      await request(app.getHttpServer())
        .post('/api/v1/catalog/products/chair/qa/messages')
        .send({ body: '' })
        .expect(400);
    });
  });

  describe('PATCH /catalog/products/:slug/qa/messages/:messageId', () => {
    it('returns 403 for USER (edit via correspondence in ЛК)', async () => {
      currentUser = { sub: 'u1', role: UserRole.USER, email: 'u@test.com' };

      await request(app.getHttpServer())
        .patch('/api/v1/catalog/products/chair/qa/messages/m1')
        .send({ body: 'Новый текст' })
        .expect(403);
    });

    it('returns 403 for staff on public route (use admin PATCH)', async () => {
      currentUser = { sub: 's1', role: UserRole.ADMIN, email: 'admin@test.com' };

      await request(app.getHttpServer())
        .patch('/api/v1/catalog/products/chair/qa/messages/m1')
        .send({ body: 'Новый текст' })
        .expect(403);
    });
  });

  describe('Admin /catalog/admin/products/:id/qa/*', () => {
    beforeEach(() => {
      currentUser = { sub: 's1', role: UserRole.ADMIN, email: 'admin@test.com' };
    });

    it('GET messages includes non-visible for staff', async () => {
      qa.listMessagesForProductAsStaff.mockResolvedValue({
        threadId: 't1',
        messages: [{ ...sampleMessage, status: ProductQaMessageStatus.HIDDEN }],
        hasOlder: false,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/catalog/admin/products/p1/qa/messages')
        .expect(200);

      expect(res.body.messages[0].status).toBe('HIDDEN');
      expect(qa.listMessagesForProductAsStaff).toHaveBeenCalledWith('s1', UserRole.ADMIN, 'p1', {
        limit: undefined,
        beforeMessageId: undefined,
        includeNonVisible: true,
        topicSlug: undefined,
        status: undefined,
      });
    });

    it('POST staff reply is forbidden (use correspondence)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/catalog/admin/products/p1/qa/messages')
        .send({ body: 'Ответ' })
        .expect(403);

      expect(res.body.message).toMatch(/correspondence/i);
      expect(qa.postMessageForProduct).not.toHaveBeenCalled();
    });

    it('PATCH hide message', async () => {
      qa.setMessageStatus.mockResolvedValue({
        ...sampleMessage,
        status: ProductQaMessageStatus.HIDDEN,
      });

      const res = await request(app.getHttpServer())
        .patch('/api/v1/catalog/admin/products/p1/qa/messages/m1')
        .send({ status: 'HIDDEN' })
        .expect(200);

      expect(res.body.status).toBe('HIDDEN');
      expect(qa.setMessageStatus).toHaveBeenCalledWith(
        'p1',
        'm1',
        's1',
        UserRole.ADMIN,
        ProductQaMessageStatus.HIDDEN,
      );
    });

    it('POST soft-delete message', async () => {
      qa.setMessageStatus.mockResolvedValue({
        ...sampleMessage,
        status: ProductQaMessageStatus.DELETED,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/catalog/admin/products/p1/qa/messages/m1/delete')
        .expect(201);

      expect(res.body.status).toBe('DELETED');
      expect(qa.setMessageStatus).toHaveBeenCalledWith(
        'p1',
        'm1',
        's1',
        UserRole.ADMIN,
        ProductQaMessageStatus.DELETED,
      );
    });

    it('PATCH rejects DELETED via status endpoint', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/catalog/admin/products/p1/qa/messages/m1')
        .send({ status: 'DELETED' })
        .expect(400);
    });

    it('POST approve pending message', async () => {
      qa.approvePendingMessage.mockResolvedValue({
        ...sampleMessage,
        status: ProductQaMessageStatus.VISIBLE,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/catalog/admin/products/p1/qa/messages/m1/approve')
        .expect(201);

      expect(res.body.status).toBe('VISIBLE');
      expect(qa.approvePendingMessage).toHaveBeenCalledWith('p1', 'm1', 's1', UserRole.ADMIN);
    });

    it('POST reject pending message', async () => {
      qa.rejectPendingMessage.mockResolvedValue({
        ...sampleMessage,
        status: ProductQaMessageStatus.REJECTED,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/catalog/admin/products/p1/qa/messages/m1/reject')
        .expect(201);

      expect(res.body.status).toBe('REJECTED');
      expect(qa.rejectPendingMessage).toHaveBeenCalledWith('p1', 'm1', 's1', UserRole.ADMIN);
    });

    it('GET unread-summary for staff', async () => {
      qa.getStaffQaUnreadSummary.mockResolvedValue({ total: 3 });

      const res = await request(app.getHttpServer())
        .get('/api/v1/catalog/admin/qa/unread-summary')
        .expect(200);

      expect(res.body).toEqual({ total: 3 });
      expect(qa.getStaffQaUnreadSummary).toHaveBeenCalledWith('s1', UserRole.ADMIN, {
        from: undefined,
        to: undefined,
      });
    });

    it('GET unread-summary returns 401 without JWT', async () => {
      currentUser = null;
      await request(app.getHttpServer())
        .get('/api/v1/catalog/admin/qa/unread-summary')
        .expect(401);
    });

    it('GET pending-summary for staff', async () => {
      qa.getStaffQaPendingSummary.mockResolvedValue({
        total: 4,
        publicQaPending: 2,
        correspondenceAwaitingPublish: 2,
        byProduct: [],
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/catalog/admin/qa/pending-summary')
        .expect(200);

      expect(res.body.total).toBe(4);
      expect(qa.getStaffQaPendingSummary).toHaveBeenCalledWith('s1', UserRole.ADMIN);
    });

    it('GET pending-summary returns 401 without JWT', async () => {
      currentUser = null;
      await request(app.getHttpServer())
        .get('/api/v1/catalog/admin/qa/pending-summary')
        .expect(401);
    });

    it('GET chat-products for staff', async () => {
      qa.getStaffQaChatProducts.mockResolvedValue({
        items: [
          {
            productId: 'p1',
            productSlug: 'chair',
            productName: 'Стул',
            productImageUrl: null,
            lastMessageAt: '2026-08-10T12:00:00.000Z',
            lastMessagePreview: 'Hello',
            publicQaPending: 1,
            correspondenceAwaitingPublish: 0,
            awaitingStaffReply: true,
          },
        ],
        hasMore: false,
        nextCursor: null,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/catalog/admin/qa/chat-products')
        .query({ limit: '20' })
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].productSlug).toBe('chair');
      expect(qa.getStaffQaChatProducts).toHaveBeenCalledWith('s1', UserRole.ADMIN, {
        limit: 20,
        cursor: undefined,
      });
    });

    it('GET chat-products returns 401 without JWT', async () => {
      currentUser = null;
      await request(app.getHttpServer())
        .get('/api/v1/catalog/admin/qa/chat-products')
        .expect(401);
    });
  });
});
