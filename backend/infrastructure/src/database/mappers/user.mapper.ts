// SPDX-License-Identifier: AGPL-3.0-only

import type { RecordModel } from "pocketbase";
import { User } from "@workspace/domain/models/user/entities";

interface UserRecord extends RecordModel {
  id: string;
  email: string;
  nickname: string;
  avatar_key: string | null;
  system_config: Record<string, unknown>;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export class UserMapper {
  toDomain(record: UserRecord): User {
    return User.fromRecord({
      id: record.id,
      email: record.email,
      nickname: record.nickname,
      avatar_key: record.avatar_key,
      system_config: record.system_config ?? {},
      last_login_at: record.last_login_at,
      created_at: record.created_at,
      updated_at: record.updated_at,
    });
  }

  toRecord(user: User): Partial<UserRecord> {
    return {
      email: user.email.value,
      nickname: user.nickname.value,
      avatar_key: user.avatarUrl,
      system_config: user.systemConfig.value,
    };
  }
}
