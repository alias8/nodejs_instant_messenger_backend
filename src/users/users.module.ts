import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { MatchmakingService } from './matchmaking.service';

@Module({
  imports: [ConversationsModule],
  controllers: [UsersController],
  providers: [UsersService, MatchmakingService],
})
export class UsersModule {}
