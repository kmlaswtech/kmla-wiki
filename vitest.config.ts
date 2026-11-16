import { globSync } from "node:fs";
import { defineConfig } from "vitest/config";

// React와 브라우저 API가 필요 없는 층은 Node에서 돌린다. 경로로만 구분하므로, 이 층의 테스트가
// DOM을 필요로 하면 `.tsx`로 만들어 dom 프로젝트로 보낸다.
const pureLayers = [
  "test/**/model/**/*.{test,spec}.ts",
  "test/shared/lib/**/*.{test,spec}.ts",
];

const nodeFiles = globSync(pureLayers).map((file) =>
  file.replaceAll("\\", "/"),
);

const ignored = ["e2e/**", "node_modules/**", "build/**"];

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    testTimeout: 10_000,
    css: false,
    silent: "passed-only",
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          globals: false,
          setupFiles: ["./test/setup.node.ts"],
          include: nodeFiles,
          exclude: ignored,
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          globals: false,
          setupFiles: ["./test/setup.ts"],
          include: ["test/**/*.{test,spec}.{ts,tsx}"],
          exclude: [...ignored, ...nodeFiles],
        },
      },
    ],
  },
});
