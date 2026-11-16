import { data, Form, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/login";
import {
  loadMemberStatus,
  sanitizeNext,
  signInForDevelopment,
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
  { email: "expired@wiki.test", label: "확인 기간이 지난 회원" },
  { email: "outsider@wiki.test", label: "회원 확인이 없는 계정" },
];
const DEV_PASSWORD = "password123";

const REASON_MESSAGE: Record<string, string> = {
  expired:
    "회원 확인 기간이 지났습니다. 다시 로그인하면 보던 곳으로 돌아갑니다.",
  "not-member": "승인된 KMLA Online 회원만 이용할 수 있습니다.",
};

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
  return { reason };
}

/** 로컬 개발 로그인. "큼온으로 로그인"이 붙으면 이 action은 개발 환경에서만 쓰인다. */
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
          "로그인하지 못했습니다. 로컬 DB에 seed 계정이 있는지 확인해 주세요.",
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

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">큼온 위키</CardTitle>
          <CardDescription>
            민사고 학교생활 정보를 함께 쓰고 고치는 위키입니다. KMLA Online 승인
            회원만 볼 수 있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {reason ? (
            <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm">
              {reason}
            </p>
          ) : null}

          {/* "큼온으로 로그인"은 KMLA Online 연동 단계에서 연결한다. */}
          <Button className="w-full" disabled>
            큼온으로 로그인 (준비 중)
          </Button>
          <p className="text-xs text-muted-foreground">
            비밀번호는 kmla.online에서만 입력합니다. 위키는 회원 여부와 내부
            식별 번호만 받고, 이름·이메일·기수는 받지 않습니다.
          </p>

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
                {pending ? <Spinner /> : null}이 계정으로 들어가기
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
