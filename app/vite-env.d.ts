/// <reference types="vite/client" />

/**
 * Vite의 `ImportMetaEnv`는 모든 조회를 `any`로 본다. 필요한 키만 좁혀 적는다. `.env`에 키가 빠질
 * 수 있으므로 일부러 `undefined`를 허용하고, `app/shared/lib/env.ts`가 읽을 때 검사한다.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string | undefined;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string | undefined;
  readonly VITE_DEV_LOGIN: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
