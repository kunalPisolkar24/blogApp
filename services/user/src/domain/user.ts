import type { User } from '../generated/prisma/client.js';

export interface UserResponse {
  id: string;
  username: string;
  email: string;
  name: string | null;
  bio: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: UserResponse;
}

export interface PaginationArgs {
  limit: number;
  cursor?: string;
}

export function toUserResponse(user: User): UserResponse {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    name: user.name,
    bio: user.bio,
    avatarUrl: user.avatarUrl,
    bannerUrl: user.bannerUrl,
    createdAt: user.createdAt.toISOString(),
  };
}
