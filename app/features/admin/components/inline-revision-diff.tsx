import { useEffect, useState } from "react";

import { describeAdminError } from "../model/log";
import { docToText } from "~/features/markup";
import { DiffView, getRevisionBodies } from "~/features/pages";
import { Spinner } from "~/shared/ui/spinner";

type State =
  | { status: "loading" }
  | { status: "ready"; before: string; after: string }
  | { status: "error"; message: string };

/**
 * 한 문서의 두 판의 차이를 목록 안에서 보여 준다. `beforeId`가 `null`이면 빈 문서에서 시작한 것으로
 * (새 문서), `afterId`가 `null`이면 빈 문서로 끝난 것으로(삭제)본다. 관리자는 숨긴 판과 삭제된
 * 문서의 판도 읽는다.
 */
export function InlineRevisionDiff({
  pageId,
  beforeId,
  afterId,
}: {
  pageId: number;
  beforeId: number | null;
  afterId: number | null;
}) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    const ids = [beforeId, afterId].filter((id) => id !== null);
    getRevisionBodies(pageId, ids).then(
      (rows) => {
        if (cancelled) return;
        const text = (id: number | null) => {
          if (id === null) return "";
          const row = rows.find((candidate) => candidate.id === id);
          return row ? docToText(row.body) : null;
        };
        const before = text(beforeId);
        const after = text(afterId);
        if (before === null || after === null) {
          setState({ status: "error", message: "비교할 판을 볼 수 없습니다." });
          return;
        }
        setState({ status: "ready", before, after });
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: describeAdminError(error) });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [pageId, beforeId, afterId]);

  if (state.status === "loading") {
    return (
      <p className="flex items-center gap-2 py-3 text-muted-foreground">
        <Spinner /> 불러오는 중
      </p>
    );
  }
  if (state.status === "error") {
    return <p className="py-3 text-muted-foreground">{state.message}</p>;
  }
  return <DiffView before={state.before} after={state.after} />;
}
