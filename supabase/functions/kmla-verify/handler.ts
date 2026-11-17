/**
 * `kmla-verify`: 큼온으로 로그인한 위키 사용자가 승인된 KMLA Online 회원인지 확인하고 기록한다.
 *
 * 흐름: 위키 `/auth/callback`이 `custom:kmla`로 받은 세션의 `provider_token`(KMLA가 위키 클라이언트에
 * 발급한 OAuth 액세스 토큰)을 넘긴다. 그 토큰으로 KMLA `get_external_identity()`를 한 번 부르고,
 * 1행이면 `record_member_verification`(14일), 0행이거나 KMLA가 토큰을 거부하면
 * `revoke_member_verification`을 부른다. 토큰은 저장하지 않는다.
 *
 * 토큰 서명은 검증하지 않는다. KMLA가 그 토큰으로 RPC를 받아 주면 서명은 KMLA가 이미 검증한 것이고,
 * 서명은 페이로드 전체를 덮으므로 호출이 성공한 토큰의 `sub`·`client_id`는 믿을 수 있다. 다만
 * `sub`·`client_id` 대조는 RPC를 부르기 전에 한다. 다른 사람의 토큰이나 다른 클라이언트의 토큰을
 * 들고 와서 그 사람 자격을 이 위키 계정에 붙이는 것을 막는다.
 *
 * 이 파일은 Deno 전용 API를 쓰지 않는다. 의존성은 `index.ts`가 넣고, Vitest가 이 파일을 직접 시험한다.
 */

export interface VerifyConfig {
  /** KMLA Online Supabase 주소(`https://<ref>.supabase.co`). */
  kmlaUrl: string;
  /** KMLA Online의 publishable key. PostgREST 호출에 `apikey`로 붙인다. */
  kmlaPublishableKey: string;
  /** KMLA에 등록된 위키 OAuth 클라이언트 ID. 토큰의 `client_id`와 같아야 한다. */
  kmlaClientId: string;
  /** 브라우저에서 이 함수를 부를 수 있는 위키 주소(origin). */
  allowedOrigins: readonly string[];
}

export interface WikiUser {
  id: string;
  /** 이 위키 계정에 연결된 `custom:kmla` 신원의 `sub`(KMLA 계정 ID). 없으면 `null`. */
  kmlaSub: string | null;
}

export interface VerifyDeps {
  /** 위키 세션 토큰의 주인. 토큰이 없거나 무효면 `null`. */
  getWikiUser(jwt: string): Promise<WikiUser | null>;
  recordVerification(userId: string, kmlaProfileId: number): Promise<void>;
  revokeVerification(userId: string): Promise<void>;
  fetch: typeof fetch;
}

export type VerifyErrorCode =
  | "method_not_allowed"
  | "unauthorized"
  | "bad_request"
  | "not_kmla_user"
  | "token_mismatch"
  | "kmla_unavailable";

/** 토큰 길이 상한. KMLA 액세스 토큰은 1~2KB이고, 이보다 큰 입력은 볼 필요가 없다. */
const MAX_TOKEN_LENGTH = 8192;

export async function handleKmlaVerify(
  request: Request,
  config: VerifyConfig,
  deps: VerifyDeps,
): Promise<Response> {
  const cors = corsHeaders(request, config.allowedOrigins);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== "POST") {
    return fail(405, "method_not_allowed", cors);
  }

  const jwt = bearerToken(request);
  if (!jwt) return fail(401, "unauthorized", cors);

  const providerToken = await readProviderToken(request);
  if (!providerToken) return fail(400, "bad_request", cors);

  const user = await deps.getWikiUser(jwt);
  if (!user) return fail(401, "unauthorized", cors);
  if (!user.kmlaSub) return fail(403, "not_kmla_user", cors);

  const claims = decodeJwtPayload(providerToken);
  if (
    claims?.sub !== user.kmlaSub ||
    claims.client_id !== config.kmlaClientId
  ) {
    return fail(403, "token_mismatch", cors);
  }

  let response: Response;
  try {
    response = await deps.fetch(
      `${config.kmlaUrl}/rest/v1/rpc/get_external_identity`,
      {
        method: "POST",
        headers: {
          apikey: config.kmlaPublishableKey,
          authorization: `Bearer ${providerToken}`,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
  } catch {
    return fail(502, "kmla_unavailable", cors);
  }

  // KMLA가 토큰을 받지 않았다(만료·폐기·권한 없음). 확인 실패로 보고 남은 기간도 끝낸다.
  if (response.status === 401 || response.status === 403) {
    await deps.revokeVerification(user.id);
    return ok(false, cors);
  }
  // 그 밖의 오류는 KMLA 쪽 장애다. 기존 확인 기간은 건드리지 않는다.
  if (!response.ok) return fail(502, "kmla_unavailable", cors);

  const profileId = profileIdOf(await response.json().catch(() => null));
  if (profileId === undefined) return fail(502, "kmla_unavailable", cors);

  if (profileId === null) {
    await deps.revokeVerification(user.id);
    return ok(false, cors);
  }
  await deps.recordVerification(user.id, profileId);
  return ok(true, cors);
}

/**
 * `get_external_identity()` 응답에서 회원 번호를 꺼낸다. 0행이면 `null`(승인 회원이 아님),
 * 모양이 다르면 `undefined`(KMLA 규약이 바뀌었거나 응답이 깨짐).
 */
function profileIdOf(body: unknown): number | null | undefined {
  if (!Array.isArray(body)) return undefined;
  if (body.length === 0) return null;
  const row: unknown = body[0];
  if (typeof row !== "object" || row === null) return undefined;
  const id = (row as { profile_id?: unknown }).profile_id;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0
    ? id
    : undefined;
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1] ?? null;
}

async function readProviderToken(request: Request): Promise<string | null> {
  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null) return null;
  const token = (body as { providerToken?: unknown }).providerToken;
  return typeof token === "string" &&
    token.length > 0 &&
    token.length <= MAX_TOKEN_LENGTH
    ? token
    : null;
}

/** JWT 페이로드를 서명 검증 없이 푼다(파일 첫 주석 참고). 형식이 틀리면 `null`. */
export function decodeJwtPayload(
  token: string,
): { sub?: unknown; client_id?: unknown } | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const base64 = part.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return typeof payload === "object" && payload !== null
      ? (payload as { sub?: unknown; client_id?: unknown })
      : null;
  } catch {
    return null;
  }
}

function corsHeaders(
  request: Request,
  allowedOrigins: readonly string[],
): Headers {
  const headers = new Headers({ vary: "Origin" });
  const origin = request.headers.get("origin");
  if (origin && allowedOrigins.includes(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-methods", "POST, OPTIONS");
    headers.set(
      "access-control-allow-headers",
      "authorization, x-client-info, apikey, content-type",
    );
  }
  return headers;
}

function ok(verified: boolean, cors: Headers): Response {
  return json(200, { verified }, cors);
}

function fail(status: number, error: VerifyErrorCode, cors: Headers): Response {
  return json(status, { error }, cors);
}

function json(status: number, body: unknown, cors: Headers): Response {
  const headers = new Headers(cors);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(body), { status, headers });
}
