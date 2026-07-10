import { Router, Request, Response } from 'express';
import { connectionManager } from '../server';
import { CustomHttpError } from '../utils/serverUtils';
import { countByUserId } from '../utils/db/user';
import { addUsersToConvo, isConversationLarge } from '../utils/db/conversationMember';
import {
  createConvoAndAddUsers,
  getConversationContainingOnlyTheseUsers,
  getConversationsForUserId,
  getJoinedSequenceWhenUserJoinedConversation,
} from '../utils/db/conversation';
import { getLatestMessages, getMessagesAfterSeq, getMessagesBeforeSeq } from '../utils/db/message';

const router = Router();

interface ConversationCreateRequest {
  userIds: string[];
}

const validateUsers = async (userIds: string[], res: Response): Promise<boolean> => {
  const countOfValidUsers = await countByUserId(userIds);
  if (countOfValidUsers !== userIds.length) {
    res.status(404).json({ error: 'One or more users not found' });
    return false;
  }
  return true;
};

const subscribeForLargeConvos = async (conversationId: string, userId: string) => {
  if (await isConversationLarge(conversationId)) {
    // Conversations with 100 of more members will have redis fan out to the channelid instead of all the userids in it
    // So, we now have to sub this server to listen for publishes to this channel
    connectionManager.subscribeToConversation(conversationId, userId);
  }
};

// Get conversations for a user, when user logs in and sees the list of convos
router.get('/', async (req: Request, res: Response) => {
  const userId = req.query.userId as string;
  if (!userId) {
    res.status(400).json({ error: 'userId is required' });
    return;
  }
  try {
    const conversations = await getConversationsForUserId(userId);
    res.json({
      conversations: conversations.map((c) => ({
        id: c.id,
        participants: c.conversationMember.map((m) => m.user),
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    res.status(500).json({ error: `Internal server error: ${message}` });
  }
});

// Create convo
router.post('/', async (req: Request, res: Response) => {
  const { userIds } = req.body as ConversationCreateRequest;
  if (!(await validateUsers(userIds, res))) return;

  const existingConvo = await getConversationContainingOnlyTheseUsers(userIds);
  if (existingConvo) {
    return res.status(200).json({ conversationId: existingConvo.id });
  }

  try {
    const conversation = await createConvoAndAddUsers(userIds);
    return res.status(200).json({ conversationId: conversation.id });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    res.status(500).json({ error: `Failed to create conversation: ${message}` });
  }
});

// Add 1 or more users to convo
router.post('/:conversationId/add/', async (req: Request, res: Response) => {
  const { userIds } = req.body as ConversationCreateRequest;
  const conversationId = req.params.conversationId as string;

  if (!(await validateUsers(userIds, res))) return;

  try {
    await addUsersToConvo(userIds, conversationId);
    return res.status(200).json({ conversationId });
  } catch (e) {
    const statusCode = e instanceof CustomHttpError ? e.statusCode : 500;
    const message = e instanceof Error ? e.message : 'Unknown error';
    res.status(statusCode).json({ error: message });
  }
});

// Get messages
router.get('/:id/messages', async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string;
    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }
    const before =
      Number(Array.isArray(req.query.before) ? req.query.before[0] : req.query.before) || 0;
    const since =
      Number(Array.isArray(req.query.since) ? req.query.since[0] : req.query.since) || 0;
    const conversationId = req.params.id as string;
    const joinedSequenceWhenUserJoinedConversation =
      await getJoinedSequenceWhenUserJoinedConversation(conversationId, userId);
    // joined_seq is a BigInt, and BigInt(0) — a perfectly valid "joined before
    // any messages existed" value — is falsy in JS, so this must check for
    // "no membership row found" specifically rather than general falsiness.
    if (joinedSequenceWhenUserJoinedConversation === undefined) {
      return res
        .status(403)
        .json({ error: `Cannot find joined seq for convo id ${conversationId} user ${userId}` });
    }
    await subscribeForLargeConvos(conversationId, userId);
    let messages;
    if (req.query.before !== undefined) {
      messages = await getMessagesBeforeSeq(
        conversationId,
        before,
        joinedSequenceWhenUserJoinedConversation,
      );
    } else if (req.query.since !== undefined) {
      messages = await getMessagesAfterSeq(
        conversationId,
        since,
        joinedSequenceWhenUserJoinedConversation,
      );
    } else {
      messages = await getLatestMessages(conversationId, joinedSequenceWhenUserJoinedConversation);
    }
    const hasMore = messages.length === 101;
    if (hasMore) messages.pop(); // reduce to 100 messages returned
    messages.reverse();
    return res.status(200).json({
      messages: messages.map((m) => ({ ...m, seq: m.seq.toString() })),
      ...(hasMore && { hasMore: true }),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    res.status(500).json({ error: `Internal server error: ${message}` });
  }
});

export default router;
