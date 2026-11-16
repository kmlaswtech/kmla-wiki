/**
 * 브라우저에 실리는 환경 값.
 *
 * SPA라 여기 값은 전부 번들에 들어가 공개된다. 비밀 키는 절대 `VITE_*`에 두지 않는다.
 * 값은 쓰는 순간에 읽는다. 빠진 변수는 import할 때가 아니라 쓸 때 실패해야 테스트와 빌드 시점
 * 렌더에서 모듈을 불러올 수 있다.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

export const env = {
  get supabaseUrl(): string {
    return required("VITE_SUPABASE_URL", import.meta.env.VITE_SUPABASE_URL);
  },
  get supabasePublishableKey(): string {
    return required(
      "VITE_SUPABASE_PUBLISHABLE_KEY",
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    );
  },
  /**
   * 로컬 개발·E2E용 이메일 로그인 폼을 보일지.
   *
   * 화면만 가리는 값이다. 운영 Supabase는 이메일 로그인 자체가 꺼져 있어서, 이 값이 켜져도 로그인은
   * 되지 않는다.
   */
  get devLogin(): boolean {
    return import.meta.env.VITE_DEV_LOGIN === "1";
  },
};
