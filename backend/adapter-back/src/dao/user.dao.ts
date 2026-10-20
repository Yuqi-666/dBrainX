// SPDX-License-Identifier: AGPL-3.0-only

import type { IUserRepository } from "@workspace/domain/repositories";
import type { User } from "@workspace/domain/models/user";
import type { Email } from "@workspace/domain/models/user/value-objects";

export class UserDao {
  constructor(private repository: IUserRepository) {}

  async findById(id: string): Promise<User | null> {
    return this.repository.findById(id);
  }

  async findByIdWithToken(id: string, token: string): Promise<User | null> {
    return this.repository.findByIdWithToken(id, token);
  }

  async findByEmail(email: Email): Promise<User | null> {
    return this.repository.findByEmail(email);
  }

  async save(user: User): Promise<User> {
    return this.repository.save(user);
  }

  async verifyPassword(
    email: Email,
    password: string,
  ): Promise<{ valid: boolean; user: User | null; token?: string }> {
    return this.repository.verifyPassword(email, password);
  }

  async createUser(
    email: Email,
    password: string,
    nickname: string,
  ): Promise<User> {
    return this.repository.createUser(email, password, nickname);
  }

  async existsByEmail(email: Email): Promise<boolean> {
    const user = await this.repository.findByEmail(email);
    return user !== null;
  }

  async existsById(id: string): Promise<boolean> {
    const user = await this.repository.findById(id);
    return user !== null;
  }
}
