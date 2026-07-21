import { Module } from '@nestjs/common';
import { ConnectionModule } from '../connection/connection.module';
import { ChatMessageService } from './chat-message.service';
import { ChatGateway } from './chat.gateway';

@Module({
  imports: [ConnectionModule],
  providers: [ChatMessageService, ChatGateway],
})
export class MessagingModule {}
