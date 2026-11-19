import { createContext, use } from "react";

import type { ImageInfo } from "~/features/images";
import type { ResolvedBody } from "~/features/pages";

/** 편집기 안의 대화상자. 툴바·입력 규칙·노드 뷰가 같은 것을 연다. */
export type EditorRequest =
  | { kind: "link" }
  /** `pos`가 있으면 그 자리의 틀을 고친다. */
  | { kind: "template"; pos?: number }
  /** `pos`가 있으면 그 자리의 각주를 고친다. */
  | { kind: "footnote"; pos?: number }
  | { kind: "table" }
  /** `pos`가 있으면 그 자리의 유튜브 영상을 고친다. */
  | { kind: "youtube"; pos?: number };

/**
 * 노드 뷰(틀·이미지·각주)가 편집기 바깥에서 받아야 하는 것. 노드 뷰는 편집기 안에 따로 그려지지만
 * React 트리로는 편집 화면 아래에 있어 이 컨텍스트를 그대로 읽는다.
 */
export interface EditorUi {
  /** 틀 본문, 있는 문서 목록. 편집이 멈출 때마다 서버에서 새로 받는다. */
  resolved: ResolvedBody;
  images: ReadonlyMap<string, ImageInfo>;
  request: (request: EditorRequest) => void;
}

const empty: EditorUi = {
  resolved: { templates: new Map(), existing: new Set() },
  images: new Map(),
  request: () => undefined,
};

export const EditorUiContext = createContext<EditorUi>(empty);

export function useEditorUi(): EditorUi {
  return use(EditorUiContext);
}
