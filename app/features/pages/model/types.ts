import type { Namespace } from "~/features/markup";

export type RevisionKind = "edit" | "revert" | "move" | "delete" | "restore";

/** 본문을 그리는 데 필요한 것. 문서 보기와 편집 미리보기가 같은 모양을 쓴다. */
export interface ResolvedBody {
  /** 끼워 넣을 틀의 본문. 키는 제목 키. */
  templates: ReadonlyMap<string, string>;
  /** 링크 대상 가운데 실제로 있는 문서의 제목 키. */
  existing: ReadonlySet<string>;
}

export interface Backlink {
  title: string;
  /** 이 문서로 넘겨주는 문서인가(본문에서 링크한 것이 아니라). */
  isRedirect: boolean;
}

interface Viewer {
  /** 차단되지 않았는가. 보호·삭제 여부는 문서 쪽에서 따로 본다. */
  canEdit: boolean;
  isAdmin: boolean;
}

export interface FoundPage extends Viewer {
  found: true;
  page: {
    id: number;
    title: string;
    namespace: Namespace;
    protection: "open" | "admin";
    redirectTarget: string | null;
    currentRevisionId: number | null;
    updatedAt: string;
    deletedAt: string | null;
  };
  /** 넘겨주기를 따라왔다면 처음 요청한 제목. */
  redirectedFrom: string | null;
  /** 볼 판. 숨겨졌거나 없는 판을 요청하면 `null`. */
  revision: {
    id: number;
    body: string;
    createdAt: string;
    isCurrent: boolean;
  } | null;
  resolved: ResolvedBody;
  backlinks: Backlink[];
  /** 하위 문서 제목. */
  children: string[];
  /** 분류 문서면 속한 문서, 틀 문서면 쓰는 문서. */
  members: string[];
}

export interface MissingPage extends Viewer {
  found: false;
  /** 정규화한 제목. 정규화할 수 없으면 `null`. */
  title: string | null;
  /** 이 제목으로 문서를 만들 수 있는가. */
  validTitle: boolean;
  backlinks: Backlink[];
}

export type PageView = FoundPage | MissingPage;

/** 판 기록과 최근 변경의 한 줄. 본문은 싣지 않는다. */
export interface RevisionSummary {
  id: number;
  parentRevisionId: number | null;
  kind: RevisionKind;
  summary: string;
  /** 그 문서에서의 가명. */
  authorPseudonym: string;
  byteSize: number;
  byteDelta: number;
  createdAt: string;
  hiddenAt: string | null;
}

export interface RecentChange extends RevisionSummary {
  pageTitle: string;
}

export interface RevisionBody extends RevisionSummary {
  body: string;
}

export interface SearchHit {
  title: string;
  /** 넘겨주기 이름으로 찾았다면 그 이름. */
  matchedRedirect: string | null;
  snippet: string | null;
}

export interface SavedRevision {
  pageId: number;
  revisionId: number;
  title: string;
}
