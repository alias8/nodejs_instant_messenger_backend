# Instant Messaging Backend

A learning project — a web-based instant messaging service (WhatsApp-like, 1:1 text only).
Built to practice system design concepts.

## Tech Stack

- **Runtime:** Node.js + TypeScript
- **HTTP/WebSocket:** Express + ws
- **Database:** PostgreSQL (persistence)
- **Cache/Pub-Sub:** Redis
- **Search:** Elasticsearch (optional locally)

The frontend lives in a separate repo: [`instant_messenger_frontend`](../instant_messenger_frontend) (React + Vite).

## Running locally

### 1. Start Postgres and Redis

```bash
redis-cli ping   # should return PONG
pg_isready       # should return "accepting connections"
```

If either isn't installed, `brew install redis` / `brew install postgresql@16`, then `brew services start redis` / `brew services start postgresql@16`.

### 2. Configure the database

Create a `.env` file in the project root with a `DATABASE_URL` pointing at a local Postgres database, e.g.:

```
DATABASE_URL="postgresql://<your-username>@localhost:5432/instant_messenger"
```

Then create the database and apply migrations:

```bash
createdb instant_messenger
npx prisma generate       # generates the Prisma client into src/generated/prisma
npx prisma migrate deploy # applies existing migrations
npm run seed               # seeds user1/user2/user3 (passwords password1/password2/password3)
```

### 3. (Optional) Start Elasticsearch for message search

Requires Docker (e.g. Docker Desktop) to be installed and running.

First time only — this pulls the image and creates a container named `elasticsearch`:

```bash
npm run run-elastic-search   # runs Elasticsearch in Docker on localhost:9200
```

Subsequent runs — the container already exists, so just start/stop it directly instead of rerunning the script above (which will fail with a "container name already in use" error):

```bash
docker start elasticsearch
docker stop elasticsearch
```

If you need a completely fresh index, remove the container first (`docker rm -f elasticsearch`) then rerun `npm run run-elastic-search`.

If skipped, the server falls back to `http://localhost:9200` and search/indexing calls will fail, but messaging still works.

### 4. Start two app servers (simulating two separate servers in the cloud)

```bash
# Terminal 1
npm run port3000

# Terminal 2
npm run port3001
```

### 5. Start the frontend

The old `test3000.html` / `test3001.html` files have been replaced by a real frontend app. See the [frontend README](../instant_messenger_frontend/README.md) for how to run it against these two backend ports.

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