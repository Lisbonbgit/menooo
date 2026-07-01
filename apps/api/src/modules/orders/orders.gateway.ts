import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';

function corsOrigins() {
  return (process.env.CORS_ORIGINS ?? 'http://localhost:3002')
    .split(',')
    .map((o) => o.trim());
}

/** Sala por restaurante para difundir encomendas em tempo real ao painel. */
function room(tenantId: string) {
  return `tenant:${tenantId}`;
}

@WebSocketGateway({ cors: { origin: corsOrigins(), credentials: true } })
export class OrdersGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;

  constructor(private readonly jwt: JwtService) {}

  /** Valida o JWT do handshake e junta o cliente à sala do seu tenant. */
  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ??
        (client.handshake.headers.authorization ?? '').replace('Bearer ', '');
      const payload = await this.jwt.verifyAsync(token, {
        secret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret',
      });
      if (!payload?.tenantId) {
        client.disconnect();
        return;
      }
      client.join(room(payload.tenantId));
    } catch {
      client.disconnect();
    }
  }

  emitNewOrder(tenantId: string, order: unknown) {
    this.server.to(room(tenantId)).emit('order.created', order);
  }

  emitOrderUpdated(tenantId: string, order: unknown) {
    this.server.to(room(tenantId)).emit('order.updated', order);
  }
}
