import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Client } from '@elastic/elasticsearch';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_PUBLISH } from '../redis/redis.constants';
import { ELASTICSEARCH_CLIENT, MESSAGES_INDEX } from '../elasticsearch/elasticsearch.constants';
import { ESMessage, Message } from '../models/models';
import { IncomingMessageHandler } from '../connection/connection-manager.service';

@Injectable()
export class ChatMessageService implements IncomingMessageHandler {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_PUBLISH) private readonly redisPublish: Redis,
    @Inject(ELASTICSEARCH_CLIENT) private readonly elasticSearchClient: Client,
  ) {}

  async handleIncoming(parsedMessage: Message) {
    const { conversation_id, from_user_id, body, type, metadata } = parsedMessage;
    const seq = await this.redisPublish.incr(`conversation:${conversation_id}:seq`);

    const message = await this.prisma.message.create({
      data: {
        conversation_id,
        from_user_id,
        body,
        type,
        metadata,
        seq: BigInt(seq),
      },
    });

    this.elasticSearchClient
      .index<ESMessage>({
        index: MESSAGES_INDEX,
        id: message.id,
        document: {
          conversation_id,
          from_user_id,
          body,
          type,
          metadata,
          seq,
          created_at: message.created_at,
        },
      })
      .catch((err) => {
        console.error('Failed to index message in Elasticsearch:', err);
      });

    const recipients = await this.prisma.conversationMember.findMany({
      where: {
        conversation_id,
        NOT: { user_id: from_user_id },
      },
    });

    if (recipients.length === 0) {
      console.error(
        `No recipients found for conversation ${conversation_id} excluding user ${from_user_id}`,
      );
      return;
    }
    if (recipients.length < 100) {
      recipients.forEach((recipient) => {
        this.redisPublish.publish(
          `user:${recipient.user_id}`,
          JSON.stringify({ ...parsedMessage, created_at: message.created_at, seq }),
        );
      });
    } else {
      // If was large convo:
      this.redisPublish.publish(
        `conversation:${conversation_id}`,
        JSON.stringify({ newMessage: true }),
      );
      // Then on the client's side, they would be subscribed to large channels. They would get the message
      // that there are more messages on the large channel. When they open that channel, the messages are fetched
      // otherwise, just show an "unread" lozenge next to the channel
    }
  }
}
