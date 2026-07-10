FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
COPY src ./src
RUN npx prisma generate
RUN npx tsc

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# The compiled app itself doesn't need these, but `npx prisma migrate deploy`
# (run via a one-off ECS task command override) reads schema.prisma directly
# at runtime to know what to apply.
COPY --from=build /app/prisma ./prisma
COPY prisma.config.ts package.json ./
EXPOSE 3000
CMD ["node", "dist/server.js"]
