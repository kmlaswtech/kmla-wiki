import { defineConfig, devices } from "@playwright/test";

/**
 * E2E는 로컬 Supabase(`pnpm db:start`)와 seed 계정을 쓴다. "큼온으로 로그인"의 왕복은 자동화하지
 * 않고 수동 점검표로 확인한다.
 *
 * 127.0.0.1을 쓴다. localhost는 브라우저에 따라 ::1을 먼저 찾는다.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5183";

export default defineConfig({
  testDir: "./e2e",
  // 테스트가 같은 로컬 DB에 쓴다. 순서대로 돌린다.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    locale: "ko-KR",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "corepack pnpm exec react-router dev --host 127.0.0.1",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
