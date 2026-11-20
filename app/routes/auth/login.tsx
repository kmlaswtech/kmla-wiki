import { useState } from "react";
import { data, Form, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/login";
import {
  loadMemberStatus,
  sanitizeNext,
  signInForDevelopment,
  startKmlaSignIn,
  type LoginReason,
} from "~/features/auth";
import { env } from "~/shared/lib/env";
import { Button } from "~/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/shared/ui/card";
import { NativeSelect, NativeSelectOption } from "~/shared/ui/native-select";
import { Spinner } from "~/shared/ui/spinner";

// 로컬 seed 계정(`supabase/seed.sql`). 운영에는 없는 계정이다.
const DEV_ACCOUNTS = [
  { email: "alice@wiki.test", label: "앨리스 (회원)" },
  { email: "bob@wiki.test", label: "밥 (회원)" },
  { email: "admin@wiki.test", label: "관리자" },
  { email: "expired@wiki.test", label: "회원 확인 만료" },
  { email: "outsider@wiki.test", label: "미확인 계정" },
];
const DEV_PASSWORD = "password123";

// URL의 `reason`은 아무 값이나 올 수 있어 `string`으로 찾는다. 알려진 사유는 빠짐없이 둔다.
const REASON_MESSAGE: Record<string, string> = {
  expired: "회원 확인 기간이 만료되었습니다. 다시 로그인해 주세요.",
  "not-member": "KMLA Online 회원만 이용할 수 있습니다.",
  denied: "KMLA Online에서 로그인을 승인하지 않았습니다.",
  failed: "로그인하지 못했습니다. 잠시 뒤에 다시 시도해 주세요.",
} satisfies Record<LoginReason, string>;

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const url = new URL(request.url);
  const status = await loadMemberStatus();
  if (status?.verified) {
    throw redirect(sanitizeNext(url.searchParams.get("next")) ?? "/");
  }
  // 로그인은 됐지만 회원 확인이 없는 계정이 주소를 직접 열었을 때도 사유를 알려 준다.
  const reason =
    url.searchParams.get("reason") ??
    (status ? (status.isMember ? "expired" : "not-member") : null);
  return { reason, next: sanitizeNext(url.searchParams.get("next")) };
}

/** 로컬 개발 로그인. 개발 빌드(`VITE_DEV_LOGIN=1`)에서만 쓰인다. */
export async function clientAction({ request }: Route.ClientActionArgs) {
  const form = await request.formData();
  const email = form.get("email");
  if (!env.devLogin || typeof email !== "string") {
    return data({ error: "로그인할 수 없습니다." }, { status: 400 });
  }

  try {
    await signInForDevelopment(email, DEV_PASSWORD);
  } catch {
    return data(
      {
        error:
          "개발용 계정으로 로그인하지 못했습니다. 로컬 DB의 초기 계정을 확인해 주세요.",
      },
      { status: 400 },
    );
  }
  // loader가 회원 확인 여부를 보고 목적지로 보내거나 사유를 보여 준다.
  return redirect(new URL(request.url).pathname + new URL(request.url).search);
}

export default function LoginPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const navigation = useNavigation();
  const pending = navigation.state !== "idle";
  const reason = loaderData.reason ? REASON_MESSAGE[loaderData.reason] : null;
  const [kmlaPending, setKmlaPending] = useState(false);
  const [kmlaError, setKmlaError] = useState(false);

  async function signInWithKmla() {
    setKmlaPending(true);
    setKmlaError(false);
    try {
      // 성공하면 kmla.online으로 넘어가서 이 화면으로 돌아오지 않는다.
      await startKmlaSignIn(loaderData.next);
    } catch {
      setKmlaError(true);
      setKmlaPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">큼온 위키</CardTitle>
          <CardDescription>
            민족사관고등학교의 정보를 함께 작성하고 고치는 위키입니다. KMLA
            Online 승인 회원만 이용할 수 있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {reason ? (
            <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm">
              {reason}
            </p>
          ) : null}

          <Button
            className="w-full"
            disabled={kmlaPending}
            onClick={() => void signInWithKmla()}
          >
            {kmlaPending ? <Spinner /> : null}큼온으로 로그인
          </Button>
          {kmlaError ? (
            <p role="alert" className="text-sm text-destructive">
              kmla.online으로 이동하지 못했습니다. 잠시 뒤에 다시 시도해 주세요.
            </p>
          ) : null}

          {env.devLogin ? (
            <Form
              method="post"
              className="space-y-2 rounded-md border border-dashed p-3"
            >
              <p className="text-xs font-semibold">개발용 로그인</p>
              <NativeSelect
                name="email"
                aria-label="개발용 계정"
                className="w-full"
              >
                {DEV_ACCOUNTS.map((account) => (
                  <NativeSelectOption key={account.email} value={account.email}>
                    {account.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Button
                type="submit"
                variant="outline"
                className="w-full"
                disabled={pending}
              >
                {pending ? <Spinner /> : null}로그인
              </Button>
              {actionData?.error ? (
                <p role="alert" className="text-sm text-destructive">
                  {actionData.error}
                </p>
              ) : null}
            </Form>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
