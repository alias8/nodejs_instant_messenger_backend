import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { Prisma } from '../generated/prisma/client';
import { UsersService } from './users.service';
import { MatchmakingService, GuestRole } from './matchmaking.service';

interface UserLoginRequest {
  username: string;
  password: string;
}

const bcryptSaltRounds = 10;

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly matchmakingService: MatchmakingService,
  ) {}

  /*
  * For development
  * {
      "username": "user1",
      "password": "password1"
  }
  * */
  @Post('register')
  async register(@Body() body: UserLoginRequest, @Res() res: Response) {
    const { username, password } = body;
    try {
      const password_hash = await bcrypt.hash(password, bcryptSaltRounds);
      const user = await this.usersService.createUser(username, password_hash);
      res.json({ user });
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        res.status(409).json({ error: 'Username already taken' });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  @Post('login')
  async login(@Body() body: UserLoginRequest, @Res() res: Response) {
    const { username, password } = body;
    try {
      const user = await this.usersService.getUserByUsername(username);
      if (!user) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }
      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }
      res.cookie('session', user.id, {
        httpOnly: true,
        signed: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
      res.status(200).json({ username: user.username, id: user.id });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e: unknown) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  @Post('guest')
  async guest(@Query('role') role: string | undefined, @Res() res: Response) {
    if (role !== 'userA' && role !== 'userB') {
      res.status(400).json({ error: 'role must be userA or userB' });
      return;
    }
    try {
      const username = `guest-${uuidv4()}`;
      const password_hash = await bcrypt.hash(uuidv4(), bcryptSaltRounds); // unusable random hash; guest never logs in with a password
      const user = await this.usersService.createGuestUser(username, password_hash);

      res.cookie('session', user.id, {
        httpOnly: true,
        signed: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      const pairing = await this.matchmakingService.matchmakeGuest(role as GuestRole, user.id);

      res.status(200).json({
        id: user.id,
        username: user.username,
        conversationId: pairing?.conversationId ?? null,
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      res.status(500).json({ error: `Internal server error: ${message}` });
    }
  }

  @Post('logout')
  logout(@Res() res: Response) {
    res.clearCookie('session', { httpOnly: true, signed: true, sameSite: 'lax' });
    res.status(200).json({ ok: true });
  }

  @Get('me')
  async me(@Req() req: Request, @Res() res: Response) {
    const userId = req.signedCookies.session as string | undefined;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    try {
      const user = await this.usersService.getUserByUserId(userId);
      if (!user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }
      res.status(200).json({ id: user.id, username: user.username });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      res.status(500).json({ error: `Internal server error: ${message}` });
    }
  }

  @Get(':id')
  async getById(@Param('id') id: string, @Res() res: Response) {
    try {
      const user = await this.usersService.getUserByUserId(id);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      res.status(200).json({ user });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      res.status(500).json({ error: `Internal server error: ${message}` });
    }
  }

  @Get()
  async search(@Query('username') username: string, @Res() res: Response) {
    try {
      const users = await this.usersService.searchUsersByUsername(username);
      res.status(200).json({ users });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      res.status(500).json({ error: `Internal server error: ${message}` });
    }
  }
}
