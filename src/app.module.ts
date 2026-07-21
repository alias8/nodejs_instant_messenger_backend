import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { ElasticsearchModule } from './elasticsearch/elasticsearch.module';
import { UsersModule } from './users/users.module';
import { ConversationsModule } from './conversations/conversations.module';
import { MediaModule } from './media/media.module';
import { SearchModule } from './search/search.module';
import { MessagingModule } from './messaging/messaging.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    ElasticsearchModule,
    UsersModule,
    ConversationsModule,
    MediaModule,
    SearchModule,
    MessagingModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
