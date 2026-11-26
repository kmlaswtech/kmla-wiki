/**
 * 유튜브 영상 주소.
 *
 * 문서에는 주소가 아니라 영상 id와 시작 시각만 저장한다. 재생 주소는 화면이 여기서 만든다. 그래서
 * 문서에 다른 사이트 주소가 끼어들 수 없다.
 */

/** 유튜브 영상 id. 11글자다. */
export const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

export interface YoutubeVideo {
  videoId: string;
  /** 시작 시각(초). 처음부터면 0. */
  start: number;
}

/**
 * 붙여넣은 주소에서 영상을 찾는다. 유튜브 영상 주소가 아니면 `null`.
 *
 * 받는 꼴: `youtu.be/ID`, `youtube.com/watch?v=ID`, `/shorts/ID`, `/embed/ID`, `/live/ID`.
 * 시작 시각은 `t=90`, `t=1m30s`, `start=90`에서 읽는다. `https://`를 빼고 써도 된다.
 */
export function parseYoutubeUrl(input: string): YoutubeVideo | null {
  const text = input.trim();
  if (text === "") return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase();
  const path = url.pathname.split("/").filter(Boolean);
  let videoId: string | undefined;
  if (host === "youtu.be") {
    videoId = path[0];
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (path[0] === "watch") videoId = url.searchParams.get("v") ?? undefined;
    else if (["shorts", "embed", "live", "v"].includes(path[0] ?? ""))
      videoId = path[1];
  }
  if (!videoId || !YOUTUBE_ID.test(videoId)) return null;

  const start = parseStart(
    url.searchParams.get("t") ??
      url.searchParams.get("start") ??
      new URLSearchParams(url.hash.slice(1)).get("t"),
  );
  return { videoId, start };
}

/** 받는 가장 늦은 시작 시각(초). 유튜브 영상은 12시간을 넘지 않는다. */
const MAX_START = 12 * 3600;

/**
 * 시작 시각(초)으로 쓸 수 있는 값만 남긴다. 주소에서 읽은 값, 붙여넣은 값, 저장된 값이 모두 이것을
 * 거친다. 음수·소수·너무 큰 값은 처음부터(0)다.
 */
export function normalizeStart(value: unknown): number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_START
    ? value
    : 0;
}

/** `90`, `90s`, `1m30s`, `1h2m3s`를 초로 읽는다. 읽을 수 없거나 너무 크면 0. */
function parseStart(value: string | null): number {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return normalizeStart(Number(value));
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!match) return 0;
  const [, h = "0", m = "0", s = "0"] = match;
  return normalizeStart(Number(h) * 3600 + Number(m) * 60 + Number(s));
}

/** 재생 주소. 시청 기록용 쿠키를 덜 쓰는 `youtube-nocookie.com`으로 튼다. */
export function youtubeEmbedUrl({ videoId, start }: YoutubeVideo): string {
  const url = `https://www.youtube-nocookie.com/embed/${videoId}`;
  return start > 0 ? `${url}?start=${start}` : url;
}

/** 대화상자에 다시 보여 줄 주소. */
export function youtubeWatchUrl({ videoId, start }: YoutubeVideo): string {
  const url = `https://youtu.be/${videoId}`;
  return start > 0 ? `${url}?t=${start}` : url;
}

/** 편집기에서 보여 줄 미리보기 그림. */
export function youtubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/** 시작 시각을 사람이 읽는 꼴로(`1:30`, `1:02:03`). */
export function formatStart(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
