# Learnings

## Image sending flow

1. Frontend calls `POST /media` with the file type
2. Backend generates a presigned S3 URL and returns it along with the S3 key (e.g. `uploads/<uuid>.png`)
3. Frontend uploads the image directly to S3 using that URL
4. Frontend sends a WebSocket message to the backend with the S3 key. Backend saves the message to Postgres and publishes to Redis for delivery
5. Recipients receive the message. If it is an image message, the frontend calls `GET /media/presigned?key=<s3-key>` to get a temporary URL to render the image

Note: the cache key used when looking up a presigned URL is the **S3 key** (short, stable string). The presigned URL itself is the cached value (the long signed URL that changes every time you generate a new one).

## Presigned URL caching

Currently the frontend requests a new presigned URL every time an image is rendered. The 1-day expiry on the URL is wasted. Options to fix this:

**Option 1 — In-memory Map (simplest)**
Store `s3Key → presignedUrl` in a JS Map. On render, check the Map first and only call the backend on a miss. Cleared when the tab closes.

**Option 2 — localStorage with expiry**
Store `{ url, fetchedAt }` in localStorage keyed by S3 key. On load, check if less than 23 hours have passed (slightly under the 1-day S3 expiry to avoid serving an expired URL). Survives page refreshes.

**Option 3 — Redis cache on the backend**
Backend checks Redis before calling AWS. If a cached URL exists and hasn't expired, return it. Otherwise generate a new presigned URL, store it in Redis with a 23hr TTL, and return it. Frontend always calls your backend — it never knows whether AWS was hit. Shared across all users and servers, so AWS is called at most once per image per day.

## How production apps serve images

Real production apps don't use presigned URLs for serving images. They put a **CDN (e.g. AWS CloudFront)** in front of S3:

```
Browser → CloudFront (CDN edge node) → S3
```

- S3 is private; CloudFront is the only thing allowed to read from it
- The image URL is stable and never expires (e.g. `https://cdn.myapp.com/uploads/<uuid>.jpg`)
- CloudFront caches the image at edge nodes geographically close to users
- The browser fetches images directly from the CDN — your backend is completely out of the picture for image delivery
- Cheaper (fewer S3 requests/transfers) and faster (global edge nodes)

**Redis cache vs CDN — key difference:**
- Redis caches the *presigned URL* (a string). The browser still calls your backend to get it, then fetches the image from S3 itself. Your backend is still in the critical path.
- CDN caches the *image bytes* at the edge. The browser fetches directly from the CDN with a stable URL. Your backend is not involved at all.

## Large group conversations

### Fan-out on write vs fan-out on read

**Fan-out on write** (current approach): when a message is sent, immediately publish to every recipient. Simple for recipients, but expensive for large groups — 5000 members means 5000 Redis publishes per message.

**Fan-out on read**: just save the message. Clients pull new messages themselves. Less work at send time, more at read time. Used by systems with very large audiences.

Production systems (Slack, Discord) often use a hybrid: small groups get fan-out on write, large channels use a different path.

### Why we publish to `user:<userId>` channels instead of `conversation:<id>` channels

**Publishing to `conversation:<id>`:**
- Sending is easy (one publish per message)
- Each server must subscribe to every conversation its connected users are part of. A user with 100 conversations means 100 subscriptions.
- Subscription lifecycle is complex: multiple users on the same server can share a conversation, so a server can't simply unsubscribe when one user leaves — it must track whether any of its connected users still need that conversation.

**Publishing to `user:<userId>`** (current approach):
- Sending requires one publish per recipient (expensive for large groups)
- Each server subscribes to exactly one channel per connected user
- Subscription lifecycle is clean: subscribe on connect, unsubscribe on disconnect

For a 1:1 messaging app, `user:<userId>` channels are clearly the right choice — subscriptions are simple and the fan-out cost is always just one publish per message.

## Other system design topics relevant to this project

### Searching messages
- `LIKE '%keyword%'` is a full table scan — unusable at scale
- **Postgres full-text search** (`tsvector`/`tsquery`) — good for moderate scale, built-in
- **Elasticsearch/OpenSearch** — for large scale. Messages are indexed asynchronously via a queue (e.g. Kafka). Postgres is the source of truth; Elasticsearch is a read-optimised replica for search. Search results may be slightly stale if the consumer falls behind.

### Pagination
- Returning all messages is fine for small datasets, unusable at scale
- **Cursor-based pagination** using the `seq` column (already in the schema) is the right approach — better than `LIMIT/OFFSET` which gets slow on large tables

### Read receipts
- Naive: a row per user per message
- At scale: store only the last-seen `seq` per user per conversation (already hinted at in the reconnect flow)

### Database sharding
- If the messages table gets huge, split it across multiple database servers
- Common shard key for messaging: `conversation_id` (keeps all messages for a conversation on one shard)

## Migrating from Express to NestJS

The whole backend (REST routes + raw `ws` WebSocket server) was ported from hand-rolled Express to NestJS on the `nestjs-migration` branch, keeping the HTTP contract and runtime behavior identical so the existing frontend needs no changes.

- **Dependency injection replaces module-level singletons.** The old code exported shared instances (`prisma`, `redisPublish`, `connectionManager`, `elasticSearchClient`) from `server.ts` and imported them wherever needed — a form of the singleton pattern via ES module caching. Nest's DI does the same job explicitly: `@Global()` modules (`PrismaModule`, `RedisModule`, `ElasticsearchModule`) provide single instances that any service can request via constructor injection, without a chain of relative imports back to one file.
- **A raw `ws` server can still share one HTTP port with Nest.** Nest's WebSocket gateways normally open their own server. `@nestjs/platform-ws`'s `WsAdapter`, passed the Nest app instance (`app.useWebSocketAdapter(new WsAdapter(app))`), attaches a `@WebSocketGateway()`'s server to the *same* underlying HTTP server instead — preserving the original single-port-per-instance deployment model (important here since `port3000`/`port3001` simulate two independent servers behind the same Redis/Postgres).
- **Circular module dependencies are a real design smell, not just a Nest quirk.** `ConversationsService` needed a user-existence check (originally `countByUserId` in `utils/db/user.ts`), and `MatchmakingService` (guest pairing) needed to create conversations — a natural cycle between a `UsersModule` and a `ConversationsModule`. Rather than reach for Nest's `forwardRef()`, the fix was to notice the check was a one-line Prisma query that didn't deserve cross-module coupling at all, and inline it into `ConversationsService`. The framework surfaced a coupling question that existed in the Express version too, just silently (both files simply imported `prisma` directly).
- **Framework error-handling conventions can diverge from a hand-built API's contract, and need reconciling explicitly.** Nest's default exception filter returns `{"statusCode": ..., "message": ..., "error": ...}`; the original Express app returned `{"error": "..."}`. A single global `AllExceptionsFilter` normalizes this back so the frontend's error handling didn't need to change.