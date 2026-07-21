import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { SearchController } from './search.controller';

@Module({
  imports: [ConversationsModule],
  controllers: [SearchController],
})
export class SearchModule {}
