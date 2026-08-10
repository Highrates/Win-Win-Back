import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { UserRole } from '@prisma/client';
import type { Server, Socket } from 'socket.io';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { StaffAccessService } from '../staff/staff-access.service';
import {
  PRODUCT_QA_SOCKET_NAMESPACE,
  PRODUCT_QA_WS_CORRESPONDENCE_MESSAGE_CREATED,
  PRODUCT_QA_WS_CORRESPONDENCE_MESSAGE_UPDATED,
  PRODUCT_QA_WS_MESSAGE_UPDATED,
  PRODUCT_QA_WS_STAFF_NEW_QUESTION,
  PRODUCT_QA_WS_STAFF_QA_MESSAGE_CREATED,
  PRODUCT_QA_WS_STAFF_QA_MESSAGE_UPDATED,
  ROOM_STAFF_PRODUCT_QA,
  roomProductCorrespondence,
  roomProductQa,
} from './product-qa.constants';
import { ProductQaMessageStatus } from '@prisma/client';
import { ProductCorrespondenceCoreService } from '../product-correspondence/product-correspondence-core.service';
import type { ProductCorrespondenceMessageOut } from '../product-correspondence/product-correspondence.types';
import { ProductQaCoreService } from './product-qa-core.service';
import type {
  ProductQaMessageOut,
  ProductQaMetaOut,
  ProductQaStaffNewQuestionOut,
} from './product-qa.types';
import { getProductQaWebSocketCorsOptions } from './product-qa-ws-cors';

const PRODUCT_QA_WS_CORS = getProductQaWebSocketCorsOptions();

@WebSocketGateway({
  namespace: PRODUCT_QA_SOCKET_NAMESPACE,
  cors: PRODUCT_QA_WS_CORS,
})
export class ProductQaGateway implements OnGatewayConnection {
  private readonly logger = new Logger(ProductQaGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly core: ProductQaCoreService,
    private readonly correspondenceCore: ProductCorrespondenceCoreService,
    private readonly staffAccess: StaffAccessService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const auth = client.handshake.auth as { token?: string } | undefined;
      const headerAuth = client.handshake.headers.authorization;
      const raw =
        auth?.token ??
        (typeof headerAuth === 'string' ? headerAuth.replace(/^Bearer\s+/i, '').trim() : '');
      if (!raw) return;
      const payload = this.jwt.verify<JwtPayload>(raw);
      client.data.userId = payload.sub;
      client.data.role = payload.role;
      if (payload.role === UserRole.ADMIN || payload.role === UserRole.MODERATOR) {
        const canCatalog = await this.staffAccess.canAccessSection(
          payload.sub,
          payload.role,
          'catalog',
        );
        if (canCatalog) {
          await client.join(ROOM_STAFF_PRODUCT_QA);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.debug(`product-qa WS anonymous or bad token: ${msg}`);
    }
  }

  @SubscribeMessage('join_product_qa')
  async joinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { productSlug?: string; productId?: string },
  ): Promise<{ ok: true; productId: string }> {
    try {
      const product = await this.core.resolveJoinTarget(body);
      await client.join(roomProductQa(product.id));
      return { ok: true, productId: product.id };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'join failed';
      throw new WsException(msg);
    }
  }

  @SubscribeMessage('leave_product_qa')
  async leaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { productSlug?: string; productId?: string },
  ): Promise<{ ok: true }> {
    const productId = typeof body?.productId === 'string' ? body.productId.trim() : '';
    const slug = typeof body?.productSlug === 'string' ? body.productSlug.trim() : '';
    if (productId) {
      await client.leave(roomProductQa(productId));
      return { ok: true };
    }
    if (slug) {
      try {
        const product = await this.core.resolveActiveProductBySlug(slug);
        await client.leave(roomProductQa(product.id));
      } catch {
        /* ignore */
      }
    }
    return { ok: true };
  }

  broadcastMessageCreated(productId: string, payload: ProductQaMessageOut): void {
    if (payload.status === ProductQaMessageStatus.VISIBLE) {
      this.server.to(roomProductQa(productId)).emit('message_created', payload);
      return;
    }
    this.server.to(ROOM_STAFF_PRODUCT_QA).emit(PRODUCT_QA_WS_STAFF_QA_MESSAGE_CREATED, {
      productId,
      message: payload,
    });
  }

  broadcastMessageHidden(productId: string, payload: { id: string }): void {
    this.server.to(roomProductQa(productId)).emit('message_hidden', payload);
  }

  broadcastMessageUpdated(productId: string, payload: ProductQaMessageOut): void {
    if (payload.status === ProductQaMessageStatus.VISIBLE) {
      this.server.to(roomProductQa(productId)).emit(PRODUCT_QA_WS_MESSAGE_UPDATED, payload);
      return;
    }
    this.server.to(ROOM_STAFF_PRODUCT_QA).emit(PRODUCT_QA_WS_STAFF_QA_MESSAGE_UPDATED, {
      productId,
      message: payload,
    });
  }

  broadcastMetaUpdated(productId: string, payload: ProductQaMetaOut): void {
    this.server.to(roomProductQa(productId)).emit('meta_updated', payload);
  }

  broadcastStaffNewQuestion(payload: ProductQaStaffNewQuestionOut): void {
    this.server.to(ROOM_STAFF_PRODUCT_QA).emit(PRODUCT_QA_WS_STAFF_NEW_QUESTION, payload);
  }

  @SubscribeMessage('join_product_correspondence')
  async joinCorrespondenceRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { correspondenceId?: string },
  ): Promise<{ ok: true }> {
    const userId = client.data.userId as string | undefined;
    if (!userId) throw new WsException('auth required');
    const correspondenceId = typeof body?.correspondenceId === 'string' ? body.correspondenceId.trim() : '';
    if (!correspondenceId) throw new WsException('correspondenceId required');
    try {
      await this.correspondenceCore.assertCorrespondenceAccess(
        correspondenceId,
        userId,
        typeof client.data.role === 'string' ? client.data.role : '',
      );
      await client.join(roomProductCorrespondence(correspondenceId));
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'join failed';
      throw new WsException(msg);
    }
  }

  @SubscribeMessage('leave_product_correspondence')
  async leaveCorrespondenceRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { correspondenceId?: string },
  ): Promise<{ ok: true }> {
    const correspondenceId = typeof body?.correspondenceId === 'string' ? body.correspondenceId.trim() : '';
    if (correspondenceId) {
      await client.leave(roomProductCorrespondence(correspondenceId));
    }
    return { ok: true };
  }

  broadcastCorrespondenceMessageCreated(
    correspondenceId: string,
    payload: ProductCorrespondenceMessageOut,
  ): void {
    this.server
      .to(roomProductCorrespondence(correspondenceId))
      .emit(PRODUCT_QA_WS_CORRESPONDENCE_MESSAGE_CREATED, payload);
  }

  broadcastCorrespondenceMessageUpdated(
    correspondenceId: string,
    payload: ProductCorrespondenceMessageOut,
  ): void {
    this.server
      .to(roomProductCorrespondence(correspondenceId))
      .emit(PRODUCT_QA_WS_CORRESPONDENCE_MESSAGE_UPDATED, payload);
  }
}
