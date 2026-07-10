import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});
const prisma = new PrismaClient({ adapter });
const SALT_ROUNDS = 10;

const users = [
  { username: 'user1', password: 'password1' },
  { username: 'user2', password: 'password2' },
  { username: 'user3', password: 'password3' },
];

async function seed() {
  for (const { username, password } of users) {
    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
    await prisma.user.upsert({
      where: { username },
      update: {},
      create: { username, password_hash },
    });
    console.log(`Seeded user: ${username}`);
  }
  await prisma.$disconnect();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
