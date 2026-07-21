import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { ConversationsService } from './conversations.service';
import { CustomHttpError } from '../common/errors/custom-http.error';

interface ConversationCreateRequest {
  userIds: string[];
}

@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  private async validateUsers(userIds: string[], res: Response): Promise<boolean> {
    const countOfValidUsers = await this.conversationsService.countExistingUsers(userIds);
    if (countOfValidUsers !== userIds.length) {
      res.status(404).json({ error: 'One or more users not found' });
      return false;
    }
    return true;
  }

  // Get conversations for a user, when user logs in and sees the list of convos
  @Get()
  async listConversations(@Req() req: Request, @Res() res: Response) {
    const userId = req.query.userId as string;
    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }
    try {
      const conversations = await this.conversationsService.getConversationsForUserId(userId);
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
  }

  // Create convo
  @Post()
  async createConversation(@Body() body: ConversationCreateRequest, @Res() res: Response) {
    const { userIds } = body;
    if (!(await this.validateUsers(userIds, res))) return;

    const existingConvo =
      await this.conversationsService.getConversationContainingOnlyTheseUsers(userIds);
    if (existingConvo) {
      res.status(200).json({ conversationId: existingConvo.id });
      return;
    }

    try {
      const conversation = await this.conversationsService.createConvoAndAddUsers(userIds);
      res.status(200).json({ conversationId: conversation.id });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      res.status(500).json({ error: `Failed to create conversation: ${message}` });
    }
  }

  // Add 1 or more users to convo
  @Post(':conversationId/add')
  async addUsers(
    @Param('conversationId') conversationId: string,
    @Body() body: ConversationCreateRequest,
    @Res() res: Response,
  ) {
    const { userIds } = body;
    if (!(await this.validateUsers(userIds, res))) return;

    try {
      await this.conversationsService.addUsersToConvo(userIds, conversationId);
      res.status(200).json({ conversationId });
    } catch (e) {
      const statusCode = e instanceof CustomHttpError ? e.statusCode : 500;
      const message = e instanceof Error ? e.message : 'Unknown error';
      res.status(statusCode).json({ error: message });
    }
  }

  // Get messages
  @Get(':id/messages')
  async getMessages(@Param('id') conversationId: string, @Req() req: Request, @Res() res: Response) {
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
      const joinedSequenceWhenUserJoinedConversation =
        await this.conversationsService.getJoinedSequenceWhenUserJoinedConversation(
          conversationId,
          userId,
        );
      // joined_seq is a BigInt, and BigInt(0) — a perfectly valid "joined before
      // any messages existed" value — is falsy in JS, so this must check for
      // "no membership row found" specifically rather than general falsiness.
      if (joinedSequenceWhenUserJoinedConversation === undefined) {
        res
          .status(403)
          .json({ error: `Cannot find joined seq for convo id ${conversationId} user ${userId}` });
        return;
      }
      await this.conversationsService.subscribeForLargeConvos(conversationId, userId);
      let messages;
      if (req.query.before !== undefined) {
        messages = await this.conversationsService.getMessagesBeforeSeq(
          conversationId,
          before,
          joinedSequenceWhenUserJoinedConversation,
        );
      } else if (req.query.since !== undefined) {
        messages = await this.conversationsService.getMessagesAfterSeq(
          conversationId,
          since,
          joinedSequenceWhenUserJoinedConversation,
        );
      } else {
        messages = await this.conversationsService.getLatestMessages(
          conversationId,
          joinedSequenceWhenUserJoinedConversation,
        );
      }
      const hasMore = messages.length === 101;
      if (hasMore) messages.pop(); // reduce to 100 messages returned
      messages.reverse();
      res.status(200).json({
        messages: messages.map((m) => ({ ...m, seq: m.seq.toString() })),
        ...(hasMore && { hasMore: true }),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      res.status(500).json({ error: `Internal server error: ${message}` });
    }
  }
}
