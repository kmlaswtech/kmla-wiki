// Deno 진입점. 판정은 `handler.ts`가 하고, 여기서는 환경 값과 Supabase 클라이언트만 넣는다.
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

import {
  handleKmlaVerify,
  type VerifyConfig,
  type VerifyDeps,
} from "./handler.ts";

/** 위키 Supabase에 등록한 KMLA OIDC 제공자의 이름(`auth.identities.provider`). */
const KMLA_PROVIDER = "custom:kmla";

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing secret ${name}`);
  return value;
}

const config: VerifyConfig = {
  kmlaUrl: required("KMLA_URL").replace(/\/+$/, ""),
  kmlaPublishableKey: required("KMLA_PUBLISHABLE_KEY"),
  kmlaClientId: required("KMLA_OAUTH_CLIENT_ID"),
  allowedOrigins: required("WIKI_ORIGINS")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
};

/**
 * service_role 키. `record_member_verification`·`revoke_member_verification`은 이 역할만 부를 수
 * 있다. 원격 프로젝트는 새 API 키(`SUPABASE_SECRET_KEYS`, `{"default": "sb_secret_…"}`)를 주고,
 * 옛 JWT 키를 끈 프로젝트에는 `SUPABASE_SERVICE_ROLE_KEY`가 없을 수 있다.
 */
function serviceRoleKey(): string {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) {
    try {
      const parsed: unknown = JSON.parse(keys);
      const key = (parsed as { default?: unknown } | null)?.default;
      if (typeof key === "string" && key) return key;
    } catch {
      // 아래 옛 키로 넘어간다.
    }
  }
  return required("SUPABASE_SERVICE_ROLE_KEY");
}

const admin = createClient(required("SUPABASE_URL"), serviceRoleKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const deps: VerifyDeps = {
  async getWikiUser(jwt) {
    const { data, error } = await admin.auth.getUser(jwt);
    if (error || !data.user) return null;
    const identity = data.user.identities?.find(
      (candidate) => candidate.provider === KMLA_PROVIDER,
    );
    const sub = identity?.identity_data?.sub;
    return {
      id: data.user.id,
      kmlaSub: typeof sub === "string" ? sub : (identity?.id ?? null),
    };
  },
  async recordVerification(userId, kmlaProfileId) {
    const { error } = await admin.rpc("record_member_verification", {
      p_auth_user_id: userId,
      p_kmla_profile_id: kmlaProfileId,
    });
    if (error) throw error;
  },
  async revokeVerification(userId) {
    const { error } = await admin.rpc("revoke_member_verification", {
      p_auth_user_id: userId,
    });
    if (error) throw error;
  },
  fetch: (input, init) => fetch(input, init),
};

Deno.serve(async (request) => {
  try {
    return await handleKmlaVerify(request, config, deps);
  } catch (error) {
    // 위키 DB 기록 실패 등. 브라우저는 확인 실패로 처리한다.
    console.error(error);
    return new Response(JSON.stringify({ error: "internal" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
