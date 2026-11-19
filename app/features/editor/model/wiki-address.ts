import { parseTitle } from "~/features/markup";

/**
 * 이 위키의 주소로 보는 곳. 운영과 미리보기의 `https://` 주소만 본다(다른 포트나 `http://`는 아니다).
 * 지금 열린 곳(`origin`)도 함께 본다.
 */
const WIKI_HOSTS: readonly string[] = [
  "wiki.kmla.online",
  "wiki-dev.kmla.online",
];
const WIKI_ORIGINS: readonly string[] = WIKI_HOSTS.map(
  (host) => `https://${host}`,
);

export interface WikiAddressTarget {
  title: string;
  /** `#` 뒤 문단. 없으면 빈 문자열. */
  section: string;
}

/**
 * 붙여넣은 위키 문서 주소(`https://wiki.kmla.online/w/귀가#신청`)를 문서 이름과 문단으로 바꾼다.
 * 위키 문서 보기 주소가 아니면 `null`이다. 그러면 친 글을 그대로 쓴다.
 *
 * `currentOrigin`은 지금 열린 위키의 주소다(로컬 개발 서버 등).
 */
export function wikiAddressTarget(
  value: string,
  currentOrigin?: string,
): WikiAddressTarget | null {
  const raw = value.trim();
  // 주소 앞의 `https://`를 빼고 붙여넣는 경우도 받는다.
  const withScheme = WIKI_HOSTS.some((host) => raw.startsWith(`${host}/`))
    ? `https://${raw}`
    : raw;
  if (!/^https?:\/\//i.test(withScheme)) return null;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  const known =
    WIKI_ORIGINS.includes(url.origin) ||
    (currentOrigin !== undefined && url.origin === currentOrigin);
  if (!known || !url.pathname.startsWith("/w/")) return null;

  let path: string;
  let section: string;
  try {
    path = decodeURIComponent(url.pathname.slice("/w/".length));
    section = decodeURIComponent(url.hash.replace(/^#/, ""));
  } catch {
    return null;
  }
  // 주소에서는 공백을 밑줄로 쓴다. `parseTitle`이 되돌린다.
  const title = parseTitle(path);
  if (title === null) return null;
  return { title, section: section.trim() };
}
