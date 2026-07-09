import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { UserRole } from '@prisma/client';
import type { Server, Socket } from 'socket.io';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { OrderChatService } from './order-chat.service';
import { StaffAccessService } from '../staff/staff-access.service';
import type { OrderChatMessageOut } from './order-chat.types';
import {
  ORDER_CHAT_SOCKET_NAMESPACE,
  ROOM_STAFF_ORDER_CHAT,
  roomOrderChat,
  roomSourcingChat,
} from './order-chat.constants';
import { getOrderChatWebSocketCorsOptions } from './order-chat-ws-cors';

const ORDER_CHAT_WS_CORS = getOrderChatWebSocketCorsOptions();

@WebSocketGateway({
  namespace: ORDER_CHAT_SOCKET_NAMESPACE,
  cors: ORDER_CHAT_WS_CORS,
})
export class OrderChatGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(OrderChatGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly chat: OrderChatService,
    private readonly staffAccess: StaffAccessService,
  ) {}

  afterInit(): void {
    this.chat.registerGateway(this);
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const auth = client.handshake.auth as { token?: string } | undefined;
      const headerAuth = client.handshake.headers.authorization;
      const raw =
        auth?.token ??
        (typeof headerAuth === 'string' ? headerAuth.replace(/^Bearer\s+/i, '').trim() : '');
      if (!raw) throw new Error('no token');
      const payload = this.jwt.verify<JwtPayload>(raw);
      client.data.userId = payload.sub;
      client.data.role = payload.role;
      if (payload.role === UserRole.ADMIN || payload.role === UserRole.MODERATOR) {
        const canStaffChat = await this.staffAccess.canAccessOrdersSection(
          payload.sub,
          payload.role,
        );
        if (!canStaffChat) throw new Error('staff orders access denied');
        await client.join(ROOM_STAFF_ORDER_CHAT);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`order-chat WS reject: ${msg}`);
      client.disconnect(true);
    }
  }

  @SubscribeMessage('join_order_chat')
  async joinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { orderId?: string },
  ): Promise<{ ok: true }> {
    const orderId = typeof body?.orderId === 'string' ? body.orderId.trim() : '';
    if (!orderId) throw new WsException('orderId required');
    await this.chat.verifyJoinRoom(client.data.userId, client.data.role, orderId);
    await client.join(roomOrderChat(orderId));
    return { ok: true };
  }

  @SubscribeMessage('leave_order_chat')
  async leaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { orderId?: string },
  ): Promise<{ ok: true }> {
    const orderId = typeof body?.orderId === 'string' ? body.orderId.trim() : '';
    if (!orderId) return { ok: true };
    await client.leave(roomOrderChat(orderId));
    return { ok: true };
  }

  @SubscribeMessage('join_sourcing_chat')
  async joinSourcingRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { sourcingRequestId?: string },
  ): Promise<{ ok: true }> {
    const sourcingRequestId =
      typeof body?.sourcingRequestId === 'string' ? body.sourcingRequestId.trim() : '';
    if (!sourcingRequestId) throw new WsException('sourcingRequestId required');
    await this.chat.verifyJoinSourcingRoom(client.data.userId, client.data.role, sourcingRequestId);
    await client.join(roomSourcingChat(sourcingRequestId));
    return { ok: true };
  }

  @SubscribeMessage('leave_sourcing_chat')
  async leaveSourcingRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { sourcingRequestId?: string },
  ): Promise<{ ok: true }> {
    const sourcingRequestId =
      typeof body?.sourcingRequestId === 'string' ? body.sourcingRequestId.trim() : '';
    if (!sourcingRequestId) return { ok: true };
    await client.leave(roomSourcingChat(sourcingRequestId));
    return { ok: true };
  }

  broadcastNewMessage(orderId: string, payload: OrderChatMessageOut): void {
    this.server.to(roomOrderChat(orderId)).emit('message_created', payload);
    this.server.to(ROOM_STAFF_ORDER_CHAT).emit('order_chat_updated', { orderId });
  }

  broadcastMessageDeleted(orderId: string, payload: { id: string }): void {
    this.server.to(roomOrderChat(orderId)).emit('message_deleted', payload);
    this.server.to(ROOM_STAFF_ORDER_CHAT).emit('order_chat_updated', { orderId });
  }

  broadcastSourcingNewMessage(sourcingRequestId: string, payload: OrderChatMessageOut): void {
    this.server.to(roomSourcingChat(sourcingRequestId)).emit('message_created', payload);
    this.server.to(ROOM_STAFF_ORDER_CHAT).emit('sourcing_chat_updated', { sourcingRequestId });
  }

  broadcastSourcingMessageDeleted(sourcingRequestId: string, payload: { id: string }): void {
    this.server.to(roomSourcingChat(sourcingRequestId)).emit('message_deleted', payload);
    this.server.to(ROOM_STAFF_ORDER_CHAT).emit('sourcing_chat_updated', { sourcingRequestId });
  }
}
