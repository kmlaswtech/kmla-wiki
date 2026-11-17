// 로컬 위키 Supabase에 KMLA Online OIDC 제공자(`custom:kmla`)를 등록하거나 갱신한다.
//
// custom provider는 `config.toml`로 설정할 수 없어 admin API로 넣는다. 제공자 설정은 auth DB에
// 저장되므로 `pnpm db:reset` 뒤에는 다시 실행한다. 원격 프로젝트에는 쓰지 않는다(대시보드에서 설정).
//
// 실행: `pnpm kmla:provider` (값은 supabase/functions/.env, 위키 주소와 키는 `supabase status`)

import { execSync } from "node:child_process";

import { createClient } from "@supabase/supabase-js";

const IDENTIFIER = "custom:kmla";

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(
      `${name}이(가) 없습니다. supabase/functions/.env.example을 .env로 복사해 채워 주세요.`,
    );
    process.exit(1);
  }
  return value;
}

/** `supabase status -o env`의 `KEY="value"` 줄을 읽는다. */
function localStatus() {
  const output = execSync("supabase status -o env", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const values = {};
  for (const line of output.split(/\r?\n/)) {
    const match = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
    if (match) values[match[1]] = match[2];
  }
  return values;
}

const kmlaUrl = required("KMLA_URL").replace(/\/+$/, "");
const settings = {
  name: "KMLA Online",
  client_id: required("KMLA_OAUTH_CLIENT_ID"),
  client_secret: required("KMLA_OAUTH_CLIENT_SECRET"),
  issuer: `${kmlaUrl}/auth/v1`,
  // 위키는 KMLA 계정 ID(`sub`)만 필요하다. 이메일·이름은 요청하지 않는다.
  scopes: ["openid"],
  email_optional: true,
  pkce_enabled: true,
  enabled: true,
};

const status = localStatus();
const apiUrl = status.API_URL;
const secretKey = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
if (!apiUrl || !secretKey) {
  console.error(
    "로컬 Supabase 주소나 키를 읽지 못했습니다. `pnpm db:start`로 먼저 띄워 주세요.",
  );
  process.exit(1);
}

const admin = createClient(apiUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const providers = admin.auth.admin.customProviders;

const { data: list, error: listError } = await providers.listProviders({
  type: "oidc",
});
if (listError) throw listError;

const exists = list.providers.some(
  (provider) => provider.identifier === IDENTIFIER,
);
const { error } = exists
  ? await providers.updateProvider(IDENTIFIER, settings)
  : await providers.createProvider({
      provider_type: "oidc",
      identifier: IDENTIFIER,
      ...settings,
    });
if (error) throw error;

console.log(
  `${IDENTIFIER} 제공자를 ${exists ? "갱신" : "등록"}했습니다 (issuer: ${settings.issuer}).`,
);
console.log(`KMLA 쪽 redirect URI는 ${apiUrl}/auth/v1/callback 이어야 합니다.`);
