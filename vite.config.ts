import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    // KMLA Online 개발 서버(5173)와 함께 띄울 수 있게 다른 포트를 쓴다.
    port: 5183,
    strictPort: true,
  },
});
