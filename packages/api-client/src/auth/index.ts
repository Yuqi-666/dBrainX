// SPDX-License-Identifier: AGPL-3.0-only

import type { AuthUser } from "@workspace/interfaces/models/user";

export { type AuthUser };
export { scheduleTokenRefresh, reconnectTRPCClient } from "../trpc/client";

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  nickname: string;
}

export {
  setAuthSession,
  clearAuthSession,
  decodeJwtPayload,
  readAuthSessionToken,
} from "./session";
