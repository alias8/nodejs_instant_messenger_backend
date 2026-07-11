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

## Deploying to AWS

Infrastructure lives in `infra/terraform/` (Terraform) and covers both the backend (ECS Fargate, ALB, RDS, ElastiCache) and both frontend deployments (S3 + CloudFront for `usera`/`userb`). See `infra/terraform/*.tf` for the full resource list.

### Prerequisites (one-time)

- A domain registered (e.g. via the Route 53 console) with a public hosted zone.
- AWS CLI installed and configured with credentials that have sufficient permissions (`aws configure`).
- Docker running (for building the backend image).
- Terraform installed (`brew install hashicorp/tap/terraform`).
- `infra/terraform/terraform.tfvars` created from `terraform.tfvars.example` with your `domain_name` set.

### Initial deploy

```bash
cd infra/terraform
terraform init
terraform apply -var-file=terraform.tfvars   # provisions everything; takes ~10-15 min first time
```

This creates the infrastructure but doesn't put any content in it — the ECR repo is empty, the database has no schema, and the S3 buckets are empty. Deploy the app itself, in this order:

```bash
# 1. Build + push the backend image, roll out the ECS service
bash scripts/deploy-backend.sh

# 2. Apply Prisma migrations against RDS (one-off ECS task)
bash scripts/run-migration.sh

# 3. Build + deploy both frontends to S3/CloudFront
FRONTEND_DIR=/path/to/instant_messenger_frontend \
VITE_API_BASE_URL=https://api.<your-domain> \
  bash scripts/deploy-frontend.sh
```

Your two resume links are then `https://usera.<your-domain>` and `https://userb.<your-domain>`.

### Redeploying after changes

- **Backend code changed** → `bash scripts/deploy-backend.sh` (rebuilds the image, pushes to ECR, forces a new ECS deployment). If the Prisma schema changed, also run `bash scripts/run-migration.sh` afterward.
- **Frontend code changed** → rerun step 3 above (`deploy-frontend.sh` with the same env vars) — it rebuilds both role variants, syncs them to S3, and invalidates CloudFront so the new build serves immediately.
- **Infrastructure changed** (edited a `.tf` file) → from `infra/terraform/`:
  ```bash
  terraform plan -var-file=terraform.tfvars    # review first
  terraform apply -var-file=terraform.tfvars
  ```

### Tearing it down

```bash
cd infra/terraform
terraform destroy -var-file=terraform.tfvars
```

Everything is configured for a clean teardown (`skip_final_snapshot`, `deletion_protection = false`, `force_destroy` on all buckets, `force_delete` on the ECR repo), so this removes the whole stack without manual cleanup. The Route 53 **hosted zone** isn't touched — it's referenced as a Terraform data source (created by domain registration, not by `apply`), so your domain and nameservers stay intact and you can `apply` again later without re-registering anything.

Since this project only needs to be live occasionally (e.g. around interviews), `destroy` when idle and `apply` again beforehand is the cheapest way to run it. Running continuously costs roughly $70-80/month (RDS ~$13, ElastiCache ~$10, ALB ~$18, Fargate's 2 tasks ~$30, CloudFront/S3/Route 53/ECR/ACM/SSM together under $5) — idle time between `destroy` and `apply` costs nothing beyond the ~$0.50/month Route 53 hosted zone.

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