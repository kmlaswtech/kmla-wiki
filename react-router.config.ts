import type { Config } from "@react-router/dev/config";

export default {
  // SPA mode: no runtime server. React Router still renders the root route at
  // build time to emit build/client/index.html, so the root route must stay
  // SSR-safe (no `window` access during the initial render).
  // Data loading lives in `clientLoader` / `clientAction`; authorization is
  // enforced by Supabase RLS, not by a server middleware.
  ssr: false,
  // `clientLoader`·`clientAction`을 화면 코드와 다른 파일로 나눈다. 그러면 처음 여는 화면에서 화면
  // 코드를 받는 동안 데이터 요청이 함께 시작된다. 나눌 수 없는 라우트가 있으면 빌드가 실패한다.
  // 라우트 모듈 안의 지역 선언(컴포넌트, 상수, 도우미)이 loader와 같은 import를 쓰면 나눌 수 없다.
  // 그런 선언은 feature나 옆 모듈(`title-param.ts` 등)로 옮긴다.
  splitRouteModules: "enforce",
} satisfies Config;
