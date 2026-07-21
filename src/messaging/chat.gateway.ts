import { WebSocketGateway, OnGatewayConnection } from '@nestjs/websockets';
import { WebSocket } from 'ws';
import http from 'http';
import { ConnectionManagerService } from '../connection/connection-manager.service';
import { ChatMessageService } from './chat-message.service';

// No path/port options: the WsAdapter (see main.ts) attaches this gateway's
// WebSocket server directly to the same underlying HTTP server Nest listens
// on, matching the original single-port http+ws server setup.
@WebSocketGateway()
export class ChatGateway implements OnGatewayConnection {
  constructor(
    private readonly connectionManager: ConnectionManagerService,
    private readonly chatMessageService: ChatMessageService,
  ) {}

  handleConnection(client: WebSocket, req: http.IncomingMessage) {
    this.connectionManager.handleConnection(client, req, this.chatMessageService);
  }
}
