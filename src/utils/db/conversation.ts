import { prisma } from '../../db/prisma';

export const getConversationsForUserId = async (userId: string) => {
  return prisma.conversation.findMany({
    where: { conversationMember: { some: { user_id: userId } } },
    include: {
      conversationMember: {
        include: { user: { select: { id: true, username: true, is_guest: true } } },
      },
    },
    orderBy: { created_at: 'desc' },
  });
};

export const getConversationByConversationId = async (conversationId: string) => {
  return prisma.conversation.findFirst({ where: { id: conversationId } });
};

export const getJoinedSequenceWhenUserJoinedConversation = async (
  conversationId: string,
  userId: string,
) => {
  const result = await prisma.conversationMember.findFirst({
    where: {
      conversation_id: conversationId,
      user_id: userId,
    },
    select: {
      joined_seq: true,
    },
  });
  return result?.joined_seq;
};

export const getConversationContainingOnlyTheseUsers = async (userIds: string[]) => {
  // Find a conversation that has all users as members
  return prisma.conversation.findFirst({
    where: {
      AND: [
        // All requested users are present
        ...userIds.map((id) => ({ conversationMember: { some: { user_id: id } } })),
        // No extra users are present
        { conversationMember: { every: { user_id: { in: userIds } } } },
      ],
    },
  });
};

export const createConvoAndAddUsers = async (userIds: string[]) => {
  return prisma.$transaction(async (tx) => {
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
};
