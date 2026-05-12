export const ORDER_CHAT_SOCKET_NAMESPACE = '/order-chat';
export const ROOM_STAFF_ORDER_CHAT = 'staffOrderChat';

export function roomOrderChat(orderId: string): string {
  return `orderChat:${orderId}`;
}
