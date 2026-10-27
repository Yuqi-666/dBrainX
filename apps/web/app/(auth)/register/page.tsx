// SPDX-License-Identifier: AGPL-3.0-only

"use client";
import { useI18n } from "@workspace/ui/lib/i18n";

import { useState } from "react";
import { useRouter } from "next/navigation";
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

export default function RegisterPage() {
  const { t } = useI18n();

  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState("");

  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: (data) => {
      setUser(data.user);
      if (data.token) {
        setAuthSession(data.token);
        reconnectTRPCClient();
        scheduleTokenRefresh(data.token);
      }
      router.push("/graph");
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    registerMutation.mutate({ email, password, nickname });
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{t("Create Account")}</CardTitle>
        <CardDescription>
          {t("Join dBrainX to build your knowledge graph")}{" "}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nickname">{t("Nickname")}</Label>
            <Input
              id="nickname"
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={t("Your display name")}
              required
            />
          </div>
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
              placeholder={t("Min 8 characters")}
              minLength={8}
              required
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button
            type="submit"
            className="w-full"
            disabled={registerMutation.isPending}
          >
            {registerMutation.isPending
              ? t("Creating account...")
              : t("Create Account")}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm">
          {t("Already have an account?")}{" "}
          <a href="/login" className="text-primary hover:underline">
            {t("Sign In")}{" "}
          </a>
        </p>
      </CardContent>
    </Card>
  );
}
