import { ThemeProvider } from "next-themes";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import { useReloadOnNewVersion } from "~/shared/hooks/use-reload-on-new-version";
import { isNetworkError } from "~/shared/lib/network-error";
import { Button } from "~/shared/ui/button";
import { Toaster } from "~/shared/ui/sonner";
import { Spinner } from "~/shared/ui/spinner";
import { TooltipProvider } from "~/shared/ui/tooltip";
import "./app.css";

const SITE_NAME = "큼온 위키";

export const meta: Route.MetaFunction = () => [
  { title: SITE_NAME },
  { name: "description", content: "민족사관고등학교 학교생활 위키" },
  // 승인 회원만 보는 사이트다. 검색 엔진에 올리지 않는다.
  { name: "robots", content: "noindex, nofollow" },
];

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
];

/**
 * 빌드할 때 한 번 렌더되어 `build/client/index.html`이 된다. 여기와 여기서 import하는 코드는
 * 렌더 중에 `window`·`document`·`localStorage`를 건드리면 안 된다.
 */
export function Layout({ children }: { children: React.ReactNode }) {
  return (
    // next-themes가 하이드레이션 전에 <html>의 class를 바꾸므로 서버 마크업과 어긋나는 게 정상이다.
    <html lang="ko" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <TooltipProvider>
            {children}
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  useReloadOnNewVersion();
  return <Outlet />;
}

/** 첫 로딩(세션 확인과 첫 화면 데이터) 동안 보인다. SPA에서는 root에서만 둘 수 있다. */
export function HydrateFallback() {
  return (
    <div className="flex h-dvh items-center justify-center">
      <Spinner className="size-6 text-muted-foreground" />
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const network = !isRouteErrorResponse(error) && isNetworkError(error);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-bold">
        {notFound
          ? "페이지를 찾을 수 없습니다"
          : network
            ? "연결할 수 없습니다"
            : "문제가 생겼습니다"}
      </h1>
      <p className="text-sm text-muted-foreground">
        {network
          ? "인터넷 연결을 확인하고 다시 시도해 주세요."
          : "잠시 뒤에 다시 시도해 주세요."}
      </p>
      <Button onClick={() => window.location.reload()}>다시 시도</Button>
      {import.meta.env.DEV && error instanceof Error ? (
        <pre className="mt-4 max-w-full overflow-auto rounded-md bg-muted p-3 text-left text-xs">
          {error.stack}
        </pre>
      ) : null}
    </main>
  );
}
