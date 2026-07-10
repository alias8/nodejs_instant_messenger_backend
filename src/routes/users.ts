import { Router, Request, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { Prisma } from '../generated/prisma/client';
import {
  createGuestUser,
  createUser,
  getUserByUserId,
  getUserByUsername,
  searchUsersByUsername,
} from '../utils/db/user';
import { redisPublish } from '../server';
import { GuestRole, matchmakeGuest } from '../utils/matchmaking';

const router = Router();

interface UserLoginRequest {
  username: string;
  password: string;
}

const bcryptSaltRounds = 10;
/*
* For development
* {
    "username": "user1",
    "password": "password1"
}
* */
router.post('/register', async (req: Request, res: Response) => {
  const { username, password } = req.body as UserLoginRequest;
  try {
    const password_hash = await bcrypt.hash(password, bcryptSaltRounds);
    const user = await createUser(username, password_hash);
    res.json({ user });
  } catch (e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      res.status(409).json({ error: 'Username already taken' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body as UserLoginRequest;
  try {
    const user = await getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    res.cookie('session', user.id, {
      httpOnly: true,
      signed: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return res.status(200).json({ username: user.username, id: user.id });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e: unknown) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/guest', async (req: Request, res: Response) => {
  const role = req.query.role as string | undefined;
  if (role !== 'userA' && role !== 'userB') {
    return res.status(400).json({ error: 'role must be userA or userB' });
  }
  try {
    const username = `guest-${uuidv4()}`;
    const password_hash = await bcrypt.hash(uuidv4(), bcryptSaltRounds); // unusable random hash; guest never logs in with a password
    const user = await createGuestUser(username, password_hash);

    res.cookie('session', user.id, {
      httpOnly: true,
      signed: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    const pairing = await matchmakeGuest(redisPublish, role as GuestRole, user.id);

    return res.status(200).json({
      id: user.id,
      username: user.username,
      conversationId: pairing?.conversationId ?? null,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    res.status(500).json({ error: `Internal server error: ${message}` });
  }
});

router.post('/logout', (req: Request, res: Response) => {
  res.clearCookie('session', { httpOnly: true, signed: true, sameSite: 'lax' });
  res.status(200).json({ ok: true });
});

router.get('/me', async (req: Request, res: Response) => {
  const userId = req.signedCookies.session as string | undefined;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const user = await getUserByUserId(userId);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    return res.status(200).json({ id: user.id, username: user.username });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    res.status(500).json({ error: `Internal server error: ${message}` });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const user = await getUserByUserId(req.params.id as string);
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.status(200).json({ user });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    res.status(500).json({ error: `Internal server error: ${message}` });
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const users = await searchUsersByUsername(req.query.username as string);
    return res.status(200).json({ users });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    res.status(500).json({ error: `Internal server error: ${message}` });
  }
});

export default router;
