// SPDX-License-Identifier: AGPL-3.0-only

import { User } from "../models/user";
import { Email } from "../models/user/value-objects";

// ============================================================
// IUserRepository - User Aggregate
// ============================================================

export interface IUserRepository {
  findById(id: string): Promise<User | null>;

  /**
   * Read a user by id using the supplied JWT as the request identity.
   * `users.viewRule = id = @request.auth.id`, so an unauthenticated client
   * (the shared singleton) is denied with 404. Use for `auth.me` lookups that
   * hold a server-verified token.
   */
  findByIdWithToken(id: string, token: string): Promise<User | null>;

  findByEmail(email: Email): Promise<User | null>;

  save(user: User): Promise<User>;

  verifyPassword(
    email: Email,
    password: string,
  ): Promise<{ valid: boolean; user: User | null; token?: string }>;

  createUser(email: Email, password: string, nickname: string): Promise<User>;
}
