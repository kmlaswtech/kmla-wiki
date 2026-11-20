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
 * 판 하나와 바로 전 판의 차이를 목록 안에서 보여 준다. 전 판이 없으면(새 문서) 본문 전체가 더해진
 * 것으로 보인다. 관리자는 숨긴 판과 삭제된 문서의 판도 읽는다.
 */
export function InlineRevisionDiff({
  pageId,
  revisionId,
  parentRevisionId,
}: {
  pageId: number;
  revisionId: number;
  parentRevisionId: number | null;
}) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    const ids =
      parentRevisionId === null ? [revisionId] : [parentRevisionId, revisionId];
    getRevisionBodies(pageId, ids).then(
      (rows) => {
        if (cancelled) return;
        const after = rows.find((row) => row.id === revisionId);
        const before = rows.find((row) => row.id === parentRevisionId);
        if (!after || (parentRevisionId !== null && !before)) {
          setState({ status: "error", message: "비교할 판을 볼 수 없습니다." });
          return;
        }
        setState({
          status: "ready",
          before: before ? docToText(before.body) : "",
          after: docToText(after.body),
        });
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
  }, [pageId, revisionId, parentRevisionId]);

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
