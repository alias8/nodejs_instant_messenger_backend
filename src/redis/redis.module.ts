import { Global, Module } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_PUBLISH, REDIS_SUBSCRIBE } from './redis.constants';

/*
 * These Redis clients are just connections to a separate and shared redis server elsewhere. All
 * servers connect to the same redis server. Publish and subscribe use separate connections
 * because ioredis puts a subscribed connection into a dedicated mode that can no longer issue
 * regular commands.
 */
function createRedisClient(): Redis {
  const redisUrl = process.env.REDIS_URL;
  return redisUrl ? new Redis(redisUrl) : new Redis(); // new Redis() with no arguments uses ioredis defaults: localhost:6379
}

@Global()
@Module({
  providers: [
    { provide: REDIS_PUBLISH, useFactory: createRedisClient },
    { provide: REDIS_SUBSCRIBE, useFactory: createRedisClient },
  ],
  exports: [REDIS_PUBLISH, REDIS_SUBSCRIBE],
})
export class RedisModule {}
