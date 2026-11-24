import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

/**
 * 빌드마다 버전 값을 하나 정해 번들(`import.meta.env.APP_VERSION`)과 `version.json`에 함께
 * 넣는다. 열어 둔 탭이 두 값을 비교해 새 배포를 알아챈다(`app/shared/hooks/use-reload-on-new-version.ts`).
 */
function appVersion(): Plugin {
  const version = Date.now().toString(36);
  return {
    name: "app-version",
    config: () => ({
      define: { "import.meta.env.APP_VERSION": JSON.stringify(version) },
    }),
    generateBundle() {
      if (this.environment.name !== "client") return;
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ version }),
      });
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), appVersion()],
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    // KMLA Online 개발 서버(5173)와 함께 띄울 수 있게 다른 포트를 쓴다.
    port: 5183,
    strictPort: true,
  },
});
