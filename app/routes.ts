import {
  index,
  layout,
  route,
  type RouteConfig,
} from "@react-router/dev/routes";

/**
 * 주소 체계.
 *
 * 문서에 대한 동작은 동작이 앞에 온다(`/edit/제목`). 제목에 `/`가 들어가는 하위 문서가 있어서
 * `/w/제목/edit` 꼴로는 "편집 화면"과 "`…/edit`라는 하위 문서"를 구분할 수 없다.
 */
export default [
  route("login", "routes/auth/login.tsx"),
  route("logout", "routes/auth/logout.tsx"),
  route("auth/callback", "routes/auth/callback.tsx"),
  // 화면이 없는 자리. 위키 껍데기의 곁 최근 변경이 fetcher로 읽는다.
  route("_panel/recent", "routes/wiki/recent-panel.ts"),
  layout("routes/wiki/gate.tsx", [
    index("routes/wiki/home.tsx"),
    route("w/*", "routes/wiki/page.tsx"),
    route("edit/*", "routes/wiki/edit.tsx"),
    route("history/*", "routes/wiki/history.tsx"),
    route("diff/*", "routes/wiki/diff.tsx"),
    route("move/*", "routes/wiki/move.tsx"),
    route("discussion/*", "routes/wiki/discussions.tsx"),
    // 토론 하나. 제목에 `/`가 들어갈 수 있어 문서 제목 대신 번호로 가리킨다.
    route("topic/:id", "routes/wiki/topic.tsx"),
    route("recent", "routes/wiki/recent.tsx"),
    route("recent-discussions", "routes/wiki/recent-discussions.tsx"),
    route("search", "routes/wiki/search.tsx"),
    route("random", "routes/wiki/random.tsx"),
    route("special", "routes/wiki/special.tsx"),
    route("me", "routes/wiki/me.tsx"),
    route("notifications", "routes/wiki/notifications.tsx"),
    route("favorites", "routes/wiki/favorites.tsx"),
    // 차단 내역과 관리 기록은 모든 회원에게 공개한다.
    route("bans", "routes/wiki/bans.tsx"),
    route("log", "routes/wiki/log.tsx"),
    route("admin", "routes/admin/index.tsx"),
    route("admin/author-edits", "routes/admin/author-edits.tsx"),
    route("admin/bulk-revert", "routes/admin/bulk-revert.tsx"),
    route("*", "routes/wiki/not-found.tsx"),
  ]),
] satisfies RouteConfig;
