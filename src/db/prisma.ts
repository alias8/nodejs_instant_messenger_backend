import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

// RDS enforces SSL on all connections by default; local Postgres doesn't need it.
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});
export const prisma = new PrismaClient({ adapter });
