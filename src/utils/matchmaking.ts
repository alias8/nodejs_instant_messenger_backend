import { Redis } from 'ioredis';
import { createConvoAndAddUsers } from './db/conversation';

export type GuestRole = 'userA' | 'userB';

const WAITING_ROOM_TTL_SECONDS = 10;

const otherRole = (role: GuestRole): GuestRole => (role === 'userA' ? 'userB' : 'userA');

// Atomically: look for a waiting partner of the opposite role.
// - If found, delete their slot and return their userId (claim).
// - If not found, set my own slot (SET ... EX 10) and return nil.
// Must run as a single Lua script (single-threaded on the Redis server) so the
// "check partner slot" and "register my own slot" branches can never interleave
// with another guest's concurrent call.
const CLAIM_OR_WAIT_LUA = `
local partnerKey = KEYS[1]
local myKey = KEYS[2]
local myUserId = ARGV[1]
local ttl = tonumber(ARGV[2])

local partnerUserId = redis.call('GET', partnerKey)
if partnerUserId then
  redis.call('DEL', partnerKey)
  return partnerUserId
else
  redis.call('SET', myKey, myUserId, 'EX', ttl)
  return false
end
`;

export async function matchmakeGuest(
  redisClient: Redis,
  role: GuestRole,
  userId: string,
): Promise<{ partnerUserId: string; conversationId: string } | null> {
  const myKey = `demo:waiting:${role}`;
  const partnerKey = `demo:waiting:${otherRole(role)}`;

  const partnerUserId = (await redisClient.eval(
    CLAIM_OR_WAIT_LUA,
    2,
    partnerKey,
    myKey,
    userId,
    WAITING_ROOM_TTL_SECONDS,
  )) as string | null;

  if (!partnerUserId) {
    return null; // registered as waiting; no partner yet
  }

  const convo = await createConvoAndAddUsers([partnerUserId, userId]);
  return { partnerUserId, conversationId: convo.id };
}
