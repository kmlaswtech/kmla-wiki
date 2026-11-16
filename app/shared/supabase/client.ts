import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { env } from "~/shared/lib/env";
import type { Database } from "./database.types";

export type TypedSupabaseClient = SupabaseClient<Database>;

let client: TypedSupabaseClient | undefined;

/**
 * 브라우저의 Supabase 클라이언트 하나.
 *
 * 서버가 없으므로 세션은 `localStorage`에 있고, 모든 읽기·쓰기의 권한은 DB의 RLS와 RPC가 정한다.
 * 모듈을 import하는 것만으로 `localStorage`를 건드리지 않도록 처음 쓸 때 만든다(빌드 시점에 root
 * route를 한 번 렌더하기 때문이다).
 */
export function getSupabase(): TypedSupabaseClient {
  if (typeof window === "undefined") {
    throw new Error(
      "getSupabase() is browser-only. Call it from a clientLoader, an event handler, or an effect.",
    );
  }

  client ??= createClient<Database>(
    env.supabaseUrl,
    env.supabasePublishableKey,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        flowType: "pkce",
        // 로그인 복귀는 `/auth/callback`이 직접 처리한다. 자동 감지에 맡기면 KMLA 토큰을 받는
        // 시점을 통제할 수 없다.
        detectSessionInUrl: false,
      },
    },
  );

  return client;
}
