# 로그인 (큼온으로 로그인)

위키 Supabase에 KMLA Online을 custom OIDC 제공자 `custom:kmla`(scope `openid`)로 붙인다. 위키
계정은 KMLA 계정 하나에 하나다. 운영에서는 다른 로그인 수단(이메일, 익명)을 모두 끈다.

## 흐름

1. `/login`이 `signInWithOAuth`를 부른다.
2. 사용자가 kmla.online에서 로그인하고 `/oauth/consent`에서 동의한다.
3. `/auth/callback`이 `exchangeCodeForSession`으로 위키 세션을 받는다.
4. 받은 `provider_token`(KMLA 토큰)을 Edge Function `kmla-verify`에 한 번 넘긴다.
5. 세션을 새로 받아 토큰을 지운다.

## `kmla-verify`

위치: `supabase/functions/kmla-verify/`. 판정은 `handler.ts`(Deno API 없음, Vitest가 시험)에,
연결은 `index.ts`에 있다.

1. 토큰의 `sub`·`client_id`를 위키 계정과 대조한다.
2. KMLA의 `get_external_identity()`를 부른다.
   - 1행이면 `record_member_verification`을 부른다. 회원 확인은 14일 동안 유효하다.
   - 0행이거나 401·403이면 `revoke_member_verification`을 부른다.
3. 확인이 끝나면 그 토큰의 KMLA 세션을 끊는다(`logout?scope=local`).

세션을 끊는 이유: KMLA OAuth 토큰은 DB 권한을 좁혀도 KMLA Auth API(이메일 조회, 비밀번호
변경)에서는 그 사용자로 동작한다. 그래서 KMLA 토큰이나 refresh token을 저장하거나 다른 곳에 쓰지
않는다.

## 로컬 개발

- custom provider는 `config.toml`로 설정할 수 없다. 로컬은 `pnpm kmla:provider`(admin API)로
  등록하고, `pnpm db:reset` 뒤에 다시 실행한다.
- 로컬 위키는 KMLA **dev 원격**을 제공자로 쓴다. 위키 auth 컨테이너에서 KMLA 로컬 issuer에 닿기
  어렵기 때문이다.
- 개발용 이메일 로그인(seed 계정)은 로컬 `config.toml`과 `VITE_DEV_LOGIN=1`에서만 쓴다. E2E도 이
  로그인을 쓴다.
