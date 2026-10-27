// SPDX-License-Identifier: AGPL-3.0-only

import { router, publicProcedure, protectedProcedure } from "../server";
import { container } from "../../di/container";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Email } from "@workspace/domain/models/user/value-objects";
import { denylistToken, getTokenExp, refreshToken } from "@workspace/infrastructure";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  nickname: z.string().min(1).max(50),
});

export const authRouter = router({
  login: publicProcedure.input(loginSchema).mutation(async ({ input }) => {
    const { email, password } = input;
    const emailVO = new Email(email);

    const result = await container().userDao.verifyPassword(emailVO, password);

    if (!result.valid || !result.user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Invalid email or password",
      });
    }

    return {
      user: result.user.toPublic(),
      token: result.token,
      tokenExp: getTokenExp(result.token ?? ""),
    };
  }),

  register: publicProcedure.input(registerSchema).mutation(async ({ input }) => {
    const { email, password, nickname } = input;

    try {
      const emailVO = new Email(email);

      const user = await container().userDao.createUser(emailVO, password, nickname);

      // Verify the fresh credentials to obtain a PocketBase-issued JWT for the new user.
      const auth = await container().userDao.verifyPassword(emailVO, password);

      return {
        user: user.toPublic(),
        token: auth.token,
        tokenExp: getTokenExp(auth.token ?? ""),
      };
    } catch (error) {
      if (error instanceof TRPCError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : "Registration failed";
      throw new TRPCError({
        code: "BAD_REQUEST",
        message,
      });
    }
  }),

  me: protectedProcedure.query(async ({ ctx }) => {
    // `users.viewRule = id = @request.auth.id` denies an unauthenticated read,
    // so resolve the identity through a per-request token-authenticated lookup.
    const user = ctx.token
      ? await container().userDao.findByIdWithToken(ctx.userId, ctx.token)
      : await container().userDao.findById(ctx.userId);

    if (!user) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "User not found",
      });
    }

    return user.toPublic();
  }),

  refresh: protectedProcedure.mutation(async ({ ctx }) => {
    if (!ctx.token) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "No token to refresh",
      });
    }
    try {
      const { token } = await refreshToken(ctx.token);
      return {
        token,
        tokenExp: getTokenExp(token),
      };
    } catch {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Session expired",
      });
    }
  }),

  logout: protectedProcedure.mutation(async ({ ctx }) => {
    // Denylist the raw token so the same JWT is rejected on any future connection.
    if (ctx.token) {
      const exp = getTokenExp(ctx.token);
      if (exp !== null) {
        denylistToken(ctx.token, exp);
      }
    }
    return { success: true };
  }),
});
