// SPDX-License-Identifier: AGPL-3.0-only

export type UserId = string;

export interface UserBase {
  id: UserId;
  email: string;
  nickname: string;
  avatarKey: string | null;
  systemConfig: Record<string, unknown>;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserRecord extends UserBase {
  username: string;
}

export interface AuthUser {
  id: string;
  email: string;
  nickname: string;
  avatarUrl: string | null;
}
