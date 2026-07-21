import { Controller, Get, Inject, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { Client } from '@elastic/elasticsearch';
import { ELASTICSEARCH_CLIENT, MESSAGES_INDEX } from '../elasticsearch/elasticsearch.constants';
import { ConversationsService } from '../conversations/conversations.service';

@Controller('search')
export class SearchController {
  constructor(
    @Inject(ELASTICSEARCH_CLIENT) private readonly elasticSearchClient: Client,
    private readonly conversationsService: ConversationsService,
  ) {}

  // Search messages for text
  @Get()
  async search(
    @Query('userId') userId: string, // todo: use JWT instead of passing id in the url
    @Query('text') text: string,
    @Res() res: Response,
  ) {
    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }
    try {
      const userConversationIds = await this.conversationsService.getConversationsIdsForUser(userId);
      const result = await this.elasticSearchClient.search({
        index: MESSAGES_INDEX,
        query: {
          bool: {
            must: { match: { body: text } },
            filter: { terms: { conversation_id: userConversationIds } },
          },
        },
      });
      res.status(200).json({ result: result.hits.hits });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      res.status(500).json({ error: `Internal server error: ${message}` });
    }
  }
}
