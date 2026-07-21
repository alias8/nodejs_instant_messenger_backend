import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { WebSocket } from 'ws';
import { URL } from 'node:url';
import http from 'http';
import { REDIS_SUBSCRIBE } from '../redis/redis.constants';
import { Message } from '../models/models';

export interface IncomingMessageHandler {
  handleIncoming(message: Message): Promise<void>;
}

@Injectable()
export class ConnectionManagerService {
  // userId: Websocket map
  private userIdToWsConnectionMap = new Map<string, WebSocket>();
  // a map of conversationId → Set of userIds connected on this server
  private conversationIdToUsersMap = new Map<string, Set<string>>();

  constructor(@Inject(REDIS_SUBSCRIBE) private redisSubscribe: Redis) {
    this.redisSubscribe.on('messageBuffer', async (channel, message) => {
      if (channel.toString().startsWith('user:')) {
        // 4. Redis received a message from userA to userB. Only the 1 server that userB is on will run this listener
        // For small convos, send to userId
        const recipientUserId = channel.toString().replace('user:', '');
        this.getSocket(recipientUserId)?.send(message.toString());
      } else if (channel.toString().startsWith('conversation:')) {
        // 4. Redis received a message from userA to conversation:123.
        // For large convos, send to entire conversation
        const recipientConversationId = channel.toString().replace('conversation:', '');
        const userIds = this.conversationIdToUsersMap.get(recipientConversationId) ?? [];
        for (const userId of userIds) {
          this.getSocket(userId)?.send(message.toString());
        }
      }
    });
  }

  /*
   1. Connection setup (before the message)
  Both users connected earlier via WebSocket to ws://localhost:3000?userId=A and ws://localhost:3001?userId=B.
  When each connected, ConnectionManagerService.add() did two things:
  - Stored their socket in userIdToWsConnectionMap (userId → ws)
  - Subscribed Redis to the channel user:<userId> for that user
  * */
  handleConnection(ws: WebSocket, req: http.IncomingMessage, messageService: IncomingMessageHandler) {
    const userId = this.getUserId(ws, req);
    if (userId) {
      this.add(userId, ws);
      this.handleMessages(ws, messageService);
      this.handleCloseConnection(ws, userId);
    }
  }

  add(userId: string, ws: WebSocket) {
    this.userIdToWsConnectionMap.set(userId, ws);
    this.redisSubscribe.subscribe(`user:${userId}`, (err, count) => {
      if (err) {
        console.error('Failed to subscribe: %s', err.message);
      } else {
        console.log(
          `Subscribed successfully! This client is currently subscribed to ${count} channels.`,
        );
      }
    });
  }

  handleMessages(ws: WebSocket, messageService: IncomingMessageHandler) {
    ws.on('message', async (message) => {
      /*
      2. userA's client sends a JSON frame over their WebSocket:
      { "conversation_id": "123", "from_user_id": "A", "body": "hey!" }
      * */
      try {
        const parsedMessage: Message = JSON.parse(message.toString());
        await messageService.handleIncoming(parsedMessage);
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : 'Unknown error';
        console.error(`Error when handling message, ${errorMessage}`);
      }
    });
  }

  handleCloseConnection(ws: WebSocket, userId: string) {
    ws.on('close', async () => {
      await this.remove(userId, ws);
    });
  }

  async remove(userId: string, ws: WebSocket) {
    // If a newer connection for this user has already replaced this one (e.g. React
    // StrictMode's double-mount opening two sockets on login), don't tear down the
    // live connection just because the stale one closed.
    if (this.userIdToWsConnectionMap.get(userId) !== ws) {
      return;
    }
    // 1. Remove userId from websocket connection map
    this.userIdToWsConnectionMap.delete(userId);
    // 2. Remove user from redis subscription
    this.redisSubscribe.unsubscribe(`user:${userId}`);

    // 3. Update conversationIdToUsersMap. If the user is a part of any of those conversations, update the Map
    for (const [conversation_id, userSet] of this.conversationIdToUsersMap) {
      if (userSet.has(userId)) {
        userSet.delete(userId);
        if (userSet.size === 0) {
          this.redisSubscribe.unsubscribe(`conversation:${conversation_id}`);
          this.conversationIdToUsersMap.delete(conversation_id);
        }
      }
    }
  }

  getUserId(ws: WebSocket, req: http.IncomingMessage) {
    // client connects to ws://localhost:3000?userId=A
    const { url } = req;
    if (!url) {
      console.error(`No url in websocket req, closing connection`);
      ws.close();
      return;
    }
    const myUrl = new URL(url, 'http://localhost:3000');
    const params = myUrl.searchParams;
    const userId = params.get('userId');
    if (!userId) {
      console.error(`No userid in websocket url ${url}, closing connection`);
      ws.close();
      return;
    }
    return userId;
  }

  getSocket(recipientUserId: string) {
    return this.userIdToWsConnectionMap.get(recipientUserId);
  }

  subscribeToConversation(conversationId: string, userId: string) {
    const currentUsersInConvo = this.conversationIdToUsersMap.get(conversationId);
    if (currentUsersInConvo === undefined) {
      this.conversationIdToUsersMap.set(conversationId, new Set([userId]));
      this.redisSubscribe.subscribe(`conversation:${conversationId}`);
    } else {
      this.conversationIdToUsersMap.set(conversationId, currentUsersInConvo.add(userId));
    }
  }
}
