import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionManagerService } from '../connection/connection-manager.service';
import { CustomHttpError } from '../common/errors/custom-http.error';

const LARGE_CONVO_MINIMUM_MEMBERS = 100;

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly connectionManager: ConnectionManagerService,
  ) {}

  getConversationsForUserId(userId: string) {
    return this.prisma.conversation.findMany({
      where: { conversationMember: { some: { user_id: userId } } },
      include: {
        conversationMember: {
          include: { user: { select: { id: true, username: true, is_guest: true } } },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  getConversationByConversationId(conversationId: string) {
    return this.prisma.conversation.findFirst({ where: { id: conversationId } });
  }

  countExistingUsers(userIds: string[]) {
    return this.prisma.user.count({ where: { id: { in: userIds } } });
  }

  async getJoinedSequenceWhenUserJoinedConversation(conversationId: string, userId: string) {
    const result = await this.prisma.conversationMember.findFirst({
      where: {
        conversation_id: conversationId,
        user_id: userId,
      },
      select: {
        joined_seq: true,
      },
    });
    return result?.joined_seq;
  }

  getConversationContainingOnlyTheseUsers(userIds: string[]) {
    // Find a conversation that has all users as members
    return this.prisma.conversation.findFirst({
      where: {
        AND: [
          // All requested users are present
          ...userIds.map((id) => ({ conversationMember: { some: { user_id: id } } })),
          // No extra users are present
          { conversationMember: { every: { user_id: { in: userIds } } } },
        ],
      },
    });
  }

  createConvoAndAddUsers(userIds: string[]) {
    return this.prisma.$transaction(async (tx) => {
      const convo = await tx.conversation.create({ data: {} });
      for (const userId of userIds) {
        await tx.conversationMember.create({
          data: {
            conversation_id: convo.id,
            user_id: userId,
            joined_seq: BigInt(0),
          },
        });
      }
      return convo;
    });
  }

  async getConversationsIdsForUser(userId: string) {
    const memberships = await this.prisma.conversationMember.findMany({
      where: { user_id: userId },
      select: { conversation_id: true },
    });
    return memberships.map((m) => m.conversation_id);
  }

  async isConversationLarge(conversationId: string) {
    const largeConvoCheck = await this.prisma.conversationMember.findMany({
      where: {
        conversation_id: conversationId,
      },
      take: LARGE_CONVO_MINIMUM_MEMBERS + 1,
    });
    return largeConvoCheck.length > LARGE_CONVO_MINIMUM_MEMBERS;
  }

  async addUsersToConvo(userIds: string[], conversationId: string) {
    const existingConvo = await this.getConversationByConversationId(conversationId);
    if (!existingConvo) {
      throw new CustomHttpError(404, `conversationid ${conversationId} not found`);
    }
    return this.prisma.$transaction(async (tx) => {
      for (const userId of userIds) {
        const alreadyInConversation = await tx.conversationMember.findFirst({
          where: {
            AND: [{ conversation_id: conversationId }, { user_id: userId }, { left_seq: null }],
          },
        });
        if (!alreadyInConversation) {
          const joined_seq = await tx.message.findFirst({
            where: {
              conversation_id: conversationId,
            },
            orderBy: { seq: 'desc' },
          });
          await tx.conversationMember.create({
            data: {
              conversation_id: existingConvo.id,
              user_id: userId,
              joined_seq: joined_seq?.seq ?? BigInt(0),
            },
          });
        }
      }
    });
  }

  getMessagesBeforeSeq(
    conversationId: string,
    before: number,
    joinedSequenceWhenUserJoinedConversation: bigint,
  ) {
    // up to 100 before that seq (scroll-back pagination)
    return this.prisma.message.findMany({
      where: {
        conversation_id: conversationId,
        seq: { lt: BigInt(before), gt: joinedSequenceWhenUserJoinedConversation },
      },
      orderBy: { seq: 'desc' },
      take: 100,
    });
  }

  getMessagesAfterSeq(
    conversationId: string,
    since: number,
    joinedSequenceWhenUserJoinedConversation: bigint,
  ) {
    // up to 100 after that seq, ordered by most recent if >100 (reconnect catch-up)
    const sinceSeq = BigInt(since);
    const maxSeq =
      sinceSeq > joinedSequenceWhenUserJoinedConversation
        ? sinceSeq
        : joinedSequenceWhenUserJoinedConversation;
    return this.prisma.message.findMany({
      where: {
        conversation_id: conversationId,
        seq: { gt: BigInt(maxSeq) },
      },
      orderBy: { seq: 'desc' },
      take: 101,
    });
  }

  getLatestMessages(conversationId: string, joinedSeq: bigint) {
    // latest 100, no params (initial load)
    return this.prisma.message.findMany({
      where: {
        conversation_id: conversationId,
        seq: { gt: joinedSeq },
      },
      orderBy: { seq: 'desc' },
      take: 100,
    });
  }

  async subscribeForLargeConvos(conversationId: string, userId: string) {
    if (await this.isConversationLarge(conversationId)) {
      // Conversations with 100 of more members will have redis fan out to the channelid instead of all the userids in it
      // So, we now have to sub this server to listen for publishes to this channel
      this.connectionManager.subscribeToConversation(conversationId, userId);
    }
  }
}
