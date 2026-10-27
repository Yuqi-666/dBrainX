// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  trpc,
  setAuthSession,
  scheduleTokenRefresh,
  reconnectTRPCClient,
} from "@workspace/api-client";
import { useAuthStore } from "@workspace/store";
import { Button } from "@workspace/ui/components/ui/button";
import { Input } from "@workspace/ui/components/ui/input";
import { Label } from "@workspace/ui/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/ui/card";

/**
 * `useSearchParams()` reads the `?redirect=` target, which is request state. Next
 * refuses to prerender the route unless that hook sits behind a Suspense
 * boundary, so the form lives in its own component. The fallback keeps the
 * card's footprint so the centred auth layout does not shift.
 */
export default function LoginPage() {
  useI18n();

  return (
    <Suspense fallback={<div className="w-full max-w-md" aria-hidden />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const { t } = useI18n();

  const router = useRouter();
  const searchParams = useSearchParams();
  const setUser = useAuthStore((s) => s.setUser);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: (data) => {
      setUser(data.user);
      if (data.token) {
        setAuthSession(data.token);
        reconnectTRPCClient();
        scheduleTokenRefresh(data.token);
      }
      const redirect = searchParams.get("redirect");
      router.push(redirect ?? "/graph");
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    loginMutation.mutate({ email, password });
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{t("Sign In")}</CardTitle>
        <CardDescription>
          {t("Enter your credentials to access your knowledge graph")}{" "}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t("Email")}</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{t("Password")}</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button
            type="submit"
            className="w-full"
            disabled={loginMutation.isPending}
          >
            {loginMutation.isPending ? t("Signing in...") : t("Sign In")}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm">
          {t("Don't have an account?")}{" "}
          <a href="/register" className="text-primary hover:underline">
            {t("Register")}{" "}
          </a>
        </p>
      </CardContent>
    </Card>
  );
}
