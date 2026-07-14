import { prisma } from '../../db/prisma';

export const searchUsersByUsername = async (username: string) => {
  return prisma.user.findMany({
    where: { username: { contains: username } },
    select: { id: true, username: true, is_guest: true },
  });
};

export const getUserByUsername = async (username: string) => {
  return prisma.user.findUnique({
    where: { username },
  });
};

export const getUserByUserId = async (userId: string) => {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, is_guest: true },
  });
};

export const countByUserId = async (userIds: string[]) => {
  return prisma.user.count({
    where: {
      id: { in: userIds },
    },
  });
};

export const createUser = async (username: string, password_hash: string) => {
  return prisma.user.create({
    data: { username, password_hash },
    select: { id: true, username: true, created_at: true },
  });
};

export const createGuestUser = async (username: string, password_hash: string) => {
  return prisma.user.create({
    data: { username, password_hash, is_guest: true },
    select: { id: true, username: true, created_at: true },
  });
};
