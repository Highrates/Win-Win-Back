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
import type { OrderChatMessageOut } from './order-chat.types';
import {
  ORDER_CHAT_SOCKET_NAMESPACE,
  ROOM_STAFF_ORDER_CHAT,
  roomOrderChat,
} from './order-chat.constants';

@WebSocketGateway({
  namespace: ORDER_CHAT_SOCKET_NAMESPACE,
  cors: { origin: true, credentials: true },
})
export class OrderChatGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(OrderChatGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly chat: OrderChatService,
  ) {}

  afterInit(): void {
    this.chat.registerGateway(this);
  }

  handleConnection(client: Socket): void {
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
        void client.join(ROOM_STAFF_ORDER_CHAT);
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

  broadcastNewMessage(orderId: string, payload: OrderChatMessageOut): void {
    this.server.to(roomOrderChat(orderId)).emit('message_created', payload);
    this.server.to(ROOM_STAFF_ORDER_CHAT).emit('order_chat_updated', { orderId });
  }

  broadcastMessageDeleted(orderId: string, payload: { id: string }): void {
    this.server.to(roomOrderChat(orderId)).emit('message_deleted', payload);
    this.server.to(ROOM_STAFF_ORDER_CHAT).emit('order_chat_updated', { orderId });
  }
}
