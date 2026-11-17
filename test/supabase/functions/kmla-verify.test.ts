import { describe, expect, it, vi } from "vitest";

import {
  handleKmlaVerify,
  type VerifyConfig,
  type VerifyDeps,
} from "../../../supabase/functions/kmla-verify/handler.ts";

const WIKI_ORIGIN = "http://127.0.0.1:5183";
const KMLA_SUB = "7b1e9a52-0000-4000-8000-000000000001";
const WIKI_USER_ID = "0c2f6d1a-0000-4000-8000-000000000002";

const config: VerifyConfig = {
  kmlaUrl: "https://kmla.example",
  kmlaPublishableKey: "sb_publishable_test",
  kmlaClientId: "wiki-client",
  allowedOrigins: [WIKI_ORIGIN],
};

/** 서명은 보지 않으므로 페이로드만 맞으면 된다. */
function token(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "ES256" })}.${encode(payload)}.signature`;
}

const validToken = token({ sub: KMLA_SUB, client_id: "wiki-client" });

function deps(kmlaResponse?: Response | Error) {
  const fetch = vi.fn<typeof globalThis.fetch>(() =>
    kmlaResponse instanceof Error
      ? Promise.reject(kmlaResponse)
      : Promise.resolve(kmlaResponse ?? Response.json([])),
  );
  return {
    getWikiUser: vi.fn<VerifyDeps["getWikiUser"]>((jwt) =>
      Promise.resolve(
        jwt === "wiki-jwt" ? { id: WIKI_USER_ID, kmlaSub: KMLA_SUB } : null,
      ),
    ),
    recordVerification: vi.fn<VerifyDeps["recordVerification"]>(() =>
      Promise.resolve(),
    ),
    revokeVerification: vi.fn<VerifyDeps["revokeVerification"]>(() =>
      Promise.resolve(),
    ),
    fetch,
  } satisfies VerifyDeps;
}

function request({
  providerToken = validToken,
  jwt = "wiki-jwt",
  origin = WIKI_ORIGIN,
  method = "POST",
}: {
  providerToken?: unknown;
  jwt?: string | null;
  origin?: string;
  method?: string;
} = {}): Request {
  const headers = new Headers({ origin, "content-type": "application/json" });
  if (jwt) headers.set("authorization", `Bearer ${jwt}`);
  return new Request("http://functions.local/kmla-verify", {
    method,
    headers,
    body: method === "POST" ? JSON.stringify({ providerToken }) : undefined,
  });
}

async function call(req: Request, d: ReturnType<typeof deps>) {
  const response = await handleKmlaVerify(req, config, d);
  return {
    response,
    body: (await response.json().catch(() => null)) as unknown,
  };
}

describe("kmla-verify", () => {
  it("records a verification when KMLA returns the member's profile", async () => {
    const d = deps(Response.json([{ profile_id: 42 }]));

    const { response, body } = await call(request(), d);

    expect(response.status).toBe(200);
    expect(body).toEqual({ verified: true });
    expect(d.recordVerification).toHaveBeenCalledWith(WIKI_USER_ID, 42);
    expect(d.revokeVerification).not.toHaveBeenCalled();
    const [url, init] = d.fetch.mock.calls[0]!;
    expect(url).toBe("https://kmla.example/rest/v1/rpc/get_external_identity");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      `Bearer ${validToken}`,
    );
  });

  it("revokes when KMLA returns no row (not an approved member)", async () => {
    const d = deps(Response.json([]));

    const { body } = await call(request(), d);

    expect(body).toEqual({ verified: false });
    expect(d.revokeVerification).toHaveBeenCalledWith(WIKI_USER_ID);
    expect(d.recordVerification).not.toHaveBeenCalled();
  });

  it.each([401, 403])(
    "revokes when KMLA rejects the token (%i)",
    async (status) => {
      const d = deps(new Response(null, { status }));

      const { body } = await call(request(), d);

      expect(body).toEqual({ verified: false });
      expect(d.revokeVerification).toHaveBeenCalledWith(WIKI_USER_ID);
    },
  );

  it.each([
    ["a server error", new Response(null, { status: 500 })],
    ["a network failure", new Error("offline")],
    ["an unexpected body", Response.json([{ profile_id: "42" }])],
  ])(
    "keeps the current verification when KMLA has %s",
    async (_, kmlaResponse) => {
      const d = deps(kmlaResponse);

      const { response, body } = await call(request(), d);

      expect(response.status).toBe(502);
      expect(body).toEqual({ error: "kmla_unavailable" });
      expect(d.recordVerification).not.toHaveBeenCalled();
      expect(d.revokeVerification).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      "another KMLA user",
      token({ sub: "someone-else", client_id: "wiki-client" }),
    ],
    ["another OAuth client", token({ sub: KMLA_SUB, client_id: "other-app" })],
    ["a regular KMLA session", token({ sub: KMLA_SUB })],
    ["a malformed token", "not-a-jwt"],
  ])(
    "rejects a token issued to %s without calling KMLA",
    async (_, providerToken) => {
      const d = deps();

      const { response, body } = await call(request({ providerToken }), d);

      expect(response.status).toBe(403);
      expect(body).toEqual({ error: "token_mismatch" });
      expect(d.fetch).not.toHaveBeenCalled();
    },
  );

  it("rejects a wiki account that did not sign in with KMLA", async () => {
    const d = deps();
    d.getWikiUser.mockResolvedValue({ id: WIKI_USER_ID, kmlaSub: null });

    const { response, body } = await call(request(), d);

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: "not_kmla_user" });
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["no session token", { jwt: null }],
    ["an invalid session token", { jwt: "forged" }],
  ])("rejects a request with %s", async (_, options) => {
    const d = deps();

    const { response } = await call(request(options), d);

    expect(response.status).toBe(401);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it.each([
    // `undefined`는 `request()`의 기본값으로 바뀌므로 `null`로 "없음"을 나타낸다.
    ["missing", null],
    ["not a string", 123],
    ["empty", ""],
  ])("rejects a %s provider token", async (_, providerToken) => {
    const { response } = await call(request({ providerToken }), deps());

    expect(response.status).toBe(400);
  });

  it("answers the CORS preflight only for the wiki origin", async () => {
    const allowed = await handleKmlaVerify(
      request({ method: "OPTIONS" }),
      config,
      deps(),
    );
    const other = await handleKmlaVerify(
      request({ method: "OPTIONS", origin: "https://evil.example" }),
      config,
      deps(),
    );

    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      WIKI_ORIGIN,
    );
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});
