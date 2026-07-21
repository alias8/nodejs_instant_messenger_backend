import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  searchUsersByUsername(username: string) {
    return this.prisma.user.findMany({
      where: { username: { contains: username } },
      select: { id: true, username: true, is_guest: true },
    });
  }

  getUserByUsername(username: string) {
    return this.prisma.user.findUnique({ where: { username } });
  }

  getUserByUserId(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, is_guest: true },
    });
  }

  createUser(username: string, password_hash: string) {
    return this.prisma.user.create({
      data: { username, password_hash },
      select: { id: true, username: true, created_at: true },
    });
  }

  createGuestUser(username: string, password_hash: string) {
    return this.prisma.user.create({
      data: { username, password_hash, is_guest: true },
      select: { id: true, username: true, created_at: true },
    });
  }
}
