import { defineConfig, devices } from "@playwright/test";

/**
 * E2E는 로컬 Supabase(`pnpm db:start`)와 seed 계정을 쓴다. "큼온으로 로그인"의 왕복은 자동화하지
 * 않고 수동 점검표로 확인한다.
 *
 * 127.0.0.1을 쓴다. localhost는 브라우저에 따라 ::1을 먼저 찾는다.
 *
 * CI는 dev 서버 대신 프로덕션 빌드를 `vite preview`로 띄워, 실제로 배포될 결과물을 검사한다.
 * 로컬은 빠른 반복을 위해 dev 서버를 쓴다.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5183";

const serverCommand = process.env.CI
  ? "corepack pnpm exec react-router build && corepack pnpm exec vite preview --host 127.0.0.1 --port 5183 --strictPort"
  : "corepack pnpm exec react-router dev --host 127.0.0.1";

export default defineConfig({
  testDir: "./e2e",
  // 테스트가 같은 로컬 DB에 쓴다. 순서대로 돌린다.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    locale: "ko-KR",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: serverCommand,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
