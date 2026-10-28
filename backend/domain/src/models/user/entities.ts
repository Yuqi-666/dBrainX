// SPDX-License-Identifier: AGPL-3.0-only

import type { UserId as UserIdType } from "@workspace/interfaces/models/user/base";
import { UserId, Email, Nickname, SystemConfig } from "./value-objects";

export interface UserProps {
  id: UserId;
  email: Email;
  nickname: Nickname;
  avatarUrl: string | null;
  systemConfig: SystemConfig;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export class User {
  private readonly _id: UserId;
  private readonly _email: Email;
  private readonly _nickname: Nickname;
  private readonly _avatarUrl: string | null;
  private readonly _systemConfig: SystemConfig;
  private readonly _lastLoginAt: string | null;
  private readonly _createdAt: string;
  private readonly _updatedAt: string;

  private constructor(props: UserProps) {
    this._id = props.id;
    this._email = props.email;
    this._nickname = props.nickname;
    this._avatarUrl = props.avatarUrl;
    this._systemConfig = props.systemConfig;
    this._lastLoginAt = props.lastLoginAt;
    this._createdAt = props.createdAt;
    this._updatedAt = props.updatedAt;
  }

  static create(props: UserProps): User {
    return new User(props);
  }

  static fromRecord(record: {
    id: string;
    email: string;
    nickname: string;
    avatar_key: string | null;
    system_config: Record<string, unknown>;
    last_login_at: string | null;
    created_at: string;
    updated_at: string;
  }): User {
    return User.create({
      id: UserId.create(record.id),
      email: new Email(record.email),
      nickname: new Nickname(record.nickname),
      avatarUrl: record.avatar_key,
      systemConfig: new SystemConfig(record.system_config ?? {}),
      lastLoginAt: record.last_login_at,
      createdAt: record.created_at,
      updatedAt: record.updated_at,
    });
  }

  get id(): UserId {
    return this._id;
  }

  get idValue(): string {
    return this._id.value;
  }

  get email(): Email {
    return this._email;
  }

  get emailValue(): string {
    return this._email.value;
  }

  get nickname(): Nickname {
    return this._nickname;
  }

  get nicknameValue(): string {
    return this._nickname.value;
  }

  get avatarUrl(): string | null {
    return this._avatarUrl;
  }

  get systemConfig(): SystemConfig {
    return this._systemConfig;
  }

  get lastLoginAt(): string | null {
    return this._lastLoginAt;
  }

  get createdAt(): string {
    return this._createdAt;
  }

  get updatedAt(): string {
    return this._updatedAt;
  }

  sameIdentityAs(other: User): boolean {
    return this._id.equals(other._id);
  }

  recordLogin(): User {
    return User.create({
      ...this.toProps(),
      lastLoginAt: new Date().toISOString(),
    });
  }

  updateNickname(nickname: Nickname): User {
    return User.create({
      ...this.toProps(),
      nickname,
      updatedAt: new Date().toISOString(),
    });
  }

  updateAvatar(avatarUrl: string | null): User {
    return User.create({
      ...this.toProps(),
      avatarUrl,
      updatedAt: new Date().toISOString(),
    });
  }

  updateSystemConfig(systemConfig: SystemConfig): User {
    return User.create({
      ...this.toProps(),
      systemConfig,
      updatedAt: new Date().toISOString(),
    });
  }

  toProps(): UserProps {
    return {
      id: this._id,
      email: this._email,
      nickname: this._nickname,
      avatarUrl: this._avatarUrl,
      systemConfig: this._systemConfig,
      lastLoginAt: this._lastLoginAt,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
    };
  }

  toPublic(): {
    id: string;
    email: string;
    nickname: string;
    avatarUrl: string | null;
  } {
    return {
      id: this._id.value,
      email: this._email.value,
      nickname: this._nickname.value,
      avatarUrl: this._avatarUrl,
    };
  }
}
