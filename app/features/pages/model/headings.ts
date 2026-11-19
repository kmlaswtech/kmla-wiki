import type { FoundPage } from "./types";
import { parseWiki } from "~/features/markup";

/** 링크가 가리킬 수 있는 문단 제목. `id`는 문서 보기에서 그 제목에 붙는 id다. */
export interface HeadingTarget {
  text: string;
  id: string;
}

/**
 * 문서 보기에 나오는 문단 제목. 문서 보기와 같은 id를 쓰도록 같은 파서로 만든다(틀이 넣은 제목도 든다).
 * 보여 줄 본문이 없거나 넘겨주기가 끊겼으면 `null`.
 */
export function headingTargets(view: FoundPage): HeadingTarget[] | null {
  if (!view.revision || view.redirect) return null;
  return parseWiki(view.revision.body, { templates: view.resolved.templates })
    .headings;
}
