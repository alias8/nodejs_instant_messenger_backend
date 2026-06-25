# Instant Messaging Backend

A learning project — a web-based instant messaging service (WhatsApp-like, 1:1 text only).
Built to practice system design concepts.

## Tech Stack

- **Runtime:** Node.js + TypeScript
- **HTTP/WebSocket:** Express + ws
- **Database:** PostgreSQL (persistence)
- **Cache/Pub-Sub:** Redis

## Running locally

Prerequisites — make sure PostgreSQL and Redis servers are running:

```bash
redis-cli ping   # should return PONG
pg_isready       # should return "accepting connections"
```

Start two app servers (simulating two separate servers in the cloud):

```bash
# Terminal 1
PORT=3000 npx ts-node src/server.ts

# Terminal 2
PORT=3001 npx ts-node src/server.ts
```

Then open `test3000.html` and `test3001.html` in a browser. Send a message from one — it should appear in the other.

## Architecture

### How multi-server messaging works

Redis and Postgres are **shared services** — every app server connects to the same instance. In the cloud they would each be their own managed service (e.g. AWS RDS for Postgres, AWS ElastiCache for Redis).

```
                    ┌─────────────────────────────────────────┐
                    │           SHARED INFRASTRUCTURE          │
                    │                                          │
                    │  ┌──────────────┐  ┌─────────────────┐  │
                    │  │  PostgreSQL  │  │      Redis      │  │
                    │  │              │  │   Pub/Sub +     │  │
                    │  │  messages    │  │   seq counters  │  │
                    │  │  users       │  │                 │  │
                    │  │  convos etc  │  │                 │  │
                    │  └──────┬───────┘  └────────┬────────┘  │
                    └─────────┼────────────────────┼──────────┘
                              │                    │
           ┌──────────────────┘          ┌─────────┘
           │                             │
┌──────────▼───────────┐      ┌──────────▼───────────┐
│      Server A        │      │      Server B        │
│                      │      │                      │
│  ConnectionManager   │      │  ConnectionManager   │
│  userMap:            │      │  userMap:            │
│    userA → ws        │      │    userB → ws        │
│                      │      │                      │
│  Redis subscribed to │      │  Redis subscribed to │
│    user:A            │      │    user:B  ◄──────── │─── listens here
│                      │      │                      │
└──────────▲───────────┘      └──────────────────────┘
           │ WebSocket                    │ WebSocket
       userA                          userB
       (browser)                      (browser)
```

### Step-by-step: userA sends a message to userB

1. **userA's browser** sends a WebSocket frame to Server A.

2. **Server A** (`MessageService`):
   - Calls Redis `INCR` to get a sequence number (avoids clock skew across servers)
   - Inserts the message into Postgres (message is now persisted)
   - Queries Postgres to find who the recipient is
   - Calls Redis `PUBLISH` on channel `user:B`

3. **Redis** broadcasts the `user:B` channel event to all subscribers.

4. **Server B** (`ConnectionManager`):
   - It subscribed to `user:B` when userB first opened their WebSocket connection
   - Redis delivers the message to Server B only (no other server subscribed to `user:B`)
   - Server B looks up userB's WebSocket in its local in-memory map
   - Calls `ws.send()` — message arrives in userB's browser

### Sending pictures

Images are uploaded directly from the browser to S3 using a presigned URL. The backend never handles the file bytes — it only exchanges short-lived signed URLs.

#### Upload flow

1. User selects a file. The frontend calls `POST /media` with the file extension.
2. The backend generates a UUID key (`uploads/<uuid>.<ext>`), creates an S3 presigned `PUT` URL valid for 5 minutes, and returns `{ url, key }`. The `PutObjectCommand` includes `CacheControl: max-age=31536000, immutable` so the object is cached aggressively once uploaded — since every upload gets a unique key, the content at that key never changes.
3. The frontend `PUT`s the file directly to S3 using the presigned URL.
4. The frontend sends a WebSocket message of type `image` with `metadata: { url, key }`. The backend persists this to Postgres and fans it out to conversation members via Redis as normal.

#### Viewing images (CloudFront)

Images are served through CloudFront rather than directly from S3. S3 is kept private; CloudFront is the only allowed reader via an Origin Access Control policy.

When a recipient's client renders an image message, the frontend calls `GET /media/presigned?key=<key>`. The backend returns a **CloudFront signed URL** valid for 24 hours. The frontend uses this as the image `src` — it is completely transparent to the frontend whether the URL points to S3 or CloudFront.

```
Browser → CloudFront edge node (cached) → S3 (on cache miss only)
```

#### Why CloudFront instead of S3 presigned URLs for download

- **Caching** — CloudFront caches the image at an edge node geographically close to the user. After the first request, subsequent loads never reach S3.
- **Speed** — CDN edge nodes are globally distributed; S3 alone serves from a single region.
- **Cost** — S3 charges per request and per GB transferred. CloudFront reduces both by serving from cache.
- **Access control** — S3 is fully private. CloudFront signed URLs restrict access to authenticated users, expiring after 24 hours.

#### Required environment variables

| Variable | Description |
|---|---|
| `S3_BUCKET_NAME` | The S3 bucket where uploads are stored |
| `CLOUDFRONT_DOMAIN` | CloudFront distribution domain, e.g. `d1234abcd.cloudfront.net` |
| `CLOUDFRONT_KEY_PAIR_ID` | Key pair ID from the CloudFront public key created in AWS |
| `CLOUDFRONT_PRIVATE_KEY` | PEM private key string downloaded when creating the key pair |

### Offline users

If userB is offline, no server is subscribed to `user:B`, so the Redis publish goes nowhere. That's fine — the message was already saved to Postgres. When userB reconnects, their client sends its last seen sequence number and fetches any missed messages from Postgres.