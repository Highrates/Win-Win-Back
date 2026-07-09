import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { OrderChatGateway } from './order-chat.gateway';

describe('OrderChatGateway', () => {
  const jwt = { verify: vi.fn() };
  const chat = { registerGateway: vi.fn() };
  const staffAccess = { canAccessOrdersSection: vi.fn() };

  let gateway: OrderChatGateway;
  let join: ReturnType<typeof vi.fn>;
  let disconnect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    gateway = new OrderChatGateway(jwt as never, chat as never, staffAccess as never);
    join = vi.fn().mockResolvedValue(undefined);
    disconnect = vi.fn();
  });

  function client(authToken?: string) {
    return {
      handshake: {
        auth: authToken ? { token: authToken } : {},
        headers: {},
      },
      data: {} as Record<string, unknown>,
      join,
      disconnect,
    };
  }

  it('joins staff room when moderator has orders section', async () => {
    jwt.verify.mockReturnValue({ sub: 'm1', role: UserRole.MODERATOR });
    staffAccess.canAccessOrdersSection.mockResolvedValue(true);

    await gateway.handleConnection(client('tok') as never);

    expect(staffAccess.canAccessOrdersSection).toHaveBeenCalledWith('m1', UserRole.MODERATOR);
    expect(join).toHaveBeenCalledWith('staffOrderChat');
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('disconnects moderator without orders section', async () => {
    jwt.verify.mockReturnValue({ sub: 'm1', role: UserRole.MODERATOR });
    staffAccess.canAccessOrdersSection.mockResolvedValue(false);

    await gateway.handleConnection(client('tok') as never);

    expect(join).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledWith(true);
  });

  it('disconnects deactivated staff on WS (admin or moderator)', async () => {
    jwt.verify.mockReturnValue({ sub: 'a1', role: UserRole.ADMIN });
    staffAccess.canAccessOrdersSection.mockResolvedValue(false);

    await gateway.handleConnection(client('tok') as never);

    expect(staffAccess.canAccessOrdersSection).toHaveBeenCalledWith('a1', UserRole.ADMIN);
    expect(join).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledWith(true);
  });

  it('disconnects on invalid token', async () => {
    jwt.verify.mockImplementation(() => {
      throw new Error('bad token');
    });

    await gateway.handleConnection(client('bad') as never);

    expect(disconnect).toHaveBeenCalledWith(true);
  });
});
