import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { bulkRevert } from "../data/mutations";
import {
  BULK_REVERT_PREVIEW_LIMIT,
  listAuthorEdits,
  type LookupSource,
} from "../data/queries";
import { authorEditsHref } from "../model/author-lookup";
import {
  BULK_REVERT_MAX,
  bulkRevertHref,
  describeBulkRevertResult,
  firstEditSince,
  isChecked,
  isSelectable,
  selectedRows,
  type BulkRevertRow,
} from "../model/bulk-revert";
import { describeAdminError } from "../model/log";
import { InlineRevisionDiff } from "./inline-revision-diff";
import { ReasonDialog } from "./reason-dialog";
import { pageHref } from "~/features/markup";
import { formatDateTime } from "~/shared/lib/time";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";
import { Spinner } from "~/shared/ui/spinner";

interface BulkRevertViewProps {
  lookupId: string;
  /** 조회의 근거 판. 허가가 끝나면 이 판에서 다시 조회한다. */
  sourceRevisionId: number;
  source: LookupSource;
  expiresAt: string;
  /** 시작점. `null`이면 대상의 모든 편집. */
  fromRevisionId: number | null;
  rows: BulkRevertRow[];
  /** 실행한 뒤 미리보기를 다시 읽는다. */
  onDone: () => void;
}

const HOUR_MS = 60 * 60 * 1000;
/** 시작점을 찾을 때 한 번에 읽는 편집 수. 서버의 최대치(`list_author_edits`)와 같다. */
const EDITS_PER_READ = 500;

/**
 * 한 사람이 시작점부터 쓴 편집을 여러 문서에서 한 번에 걷어 낸다(관리자 전용). 문서마다 무엇을 할지
 * 미리 보이고, 관리자가 고른 문서만 처리한다. 계획은 실행할 때 서버가 다시 세운다.
 */
export function BulkRevertView({
  lookupId,
  sourceRevisionId,
  source,
  expiresAt,
  fromRevisionId,
  rows,
  onDone,
}: BulkRevertViewProps) {
  const navigate = useNavigate();
  // 관리자가 바꾼 칸(문서 id → 고름). 나머지는 기본값을 따른다. 다시 읽은 뒤 고를 수 없게 된 줄은
  // 저절로 빠진다.
  const [overrides, setOverrides] = useState<ReadonlyMap<number, boolean>>(
    new Map(),
  );
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = selectedRows(rows, overrides);
  const tooMany = selected.length > BULK_REVERT_MAX;

  function setChecked(pageId: number, checked: boolean) {
    setOverrides((current) => new Map(current).set(pageId, checked));
  }

  function toggleExpanded(pageId: number) {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(pageId)) next.add(pageId);
      return next;
    });
  }

  /** 시작점을 `since` 뒤의 첫 편집으로 옮긴다. `null`이면 모든 편집. */
  async function moveStart(since: number | null) {
    setError(null);
    if (since === null) {
      void navigate(bulkRevertHref(lookupId, sourceRevisionId));
      return;
    }
    setMoving(true);
    try {
      // 편집은 최신순으로 500개씩 온다. 그 시각보다 오래된 편집이 나오거나 목록이 끝날 때까지 읽는다.
      let first: number | null = null;
      let before: number | undefined;
      for (;;) {
        const edits = await listAuthorEdits(lookupId, before, EDITS_PER_READ);
        first = firstEditSince(edits, since) ?? first;
        const oldest = edits.at(-1);
        if (
          !oldest ||
          edits.length < EDITS_PER_READ ||
          new Date(oldest.createdAt).getTime() < since
        )
          break;
        before = oldest.id;
      }
      if (first === null) {
        setError("그 시간 안에 이 사람이 쓴 편집이 없습니다.");
        return;
      }
      void navigate(bulkRevertHref(lookupId, sourceRevisionId, first));
    } catch (caught) {
      setError(describeAdminError(caught));
    } finally {
      setMoving(false);
    }
  }

  return (
    <div>
      <h1 className="mb-4 border-b pb-3 text-2xl font-bold">일괄 되돌리기</h1>

      <div className="mb-4 space-y-2 text-sm">
        <p className="text-muted-foreground">
          대상: {source.authorPseudonym} ({source.pageTitle})를 쓴 사람의 편집.
          가명은 문서마다 다릅니다. 조회 허가는 {formatDateTime(expiresAt)}
          까지입니다.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">
            범위:{" "}
            {fromRevisionId === null
              ? "모든 편집"
              : `r${fromRevisionId}부터 그 뒤의 편집`}
          </span>
          <Button
            size="xs"
            variant="outline"
            disabled={moving}
            onClick={() => void moveStart(Date.now() - HOUR_MS)}
          >
            최근 1시간
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={moving}
            onClick={() => void moveStart(new Date().setHours(0, 0, 0, 0))}
          >
            오늘
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={moving || fromRevisionId === null}
            onClick={() => void moveStart(null)}
          >
            전체
          </Button>
          {moving ? <Spinner /> : null}
          <Link
            to={authorEditsHref(sourceRevisionId, lookupId)}
            className="text-primary hover:underline"
          >
            목록에서 시작점 고르기
          </Link>
        </div>
        <p className="text-muted-foreground">
          문서마다 시작점 앞의 마지막 판으로 돌아갑니다. 본문만 되돌리고, 이동한
          제목은 그대로 둡니다.
        </p>
      </div>

      {result ? (
        <p role="status" className="mb-3 rounded-md bg-muted px-3 py-2 text-sm">
          처리했습니다: {result}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {rows.length >= BULK_REVERT_PREVIEW_LIMIT ? (
        <p role="status" className="mb-3 text-sm">
          문서가 {BULK_REVERT_PREVIEW_LIMIT}개를 넘을 수 있어 최근 것만
          보입니다. 처리한 뒤 다시 읽으면 나머지가 나옵니다.
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground">
          이 범위에 되돌릴 편집이 없습니다.
        </p>
      ) : (
        <ul className="divide-y rounded-md border text-sm">
          {rows.map((row) => {
            const selectable = isSelectable(row);
            const checked = isChecked(row, overrides);
            const open = expanded.has(row.pageId);
            return (
              <li key={row.pageId} className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="checkbox"
                    aria-label={`${row.pageTitle} 처리`}
                    checked={checked}
                    disabled={!selectable}
                    onChange={(event) =>
                      setChecked(row.pageId, event.target.checked)
                    }
                    className="size-4 accent-primary coarse:size-5"
                  />
                  <Link
                    to={pageHref(row.pageTitle, "history")}
                    className="font-medium text-primary hover:underline"
                  >
                    {row.pageTitle}
                  </Link>
                  <StatusBadge row={row} />
                  <span className="text-muted-foreground">
                    편집 {row.editCount}개
                  </span>
                  {selectable ? (
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      className="ml-auto"
                      aria-expanded={open}
                      aria-label={
                        open
                          ? `${row.pageTitle} 바뀔 내용 접기`
                          : `${row.pageTitle} 바뀔 내용 펼치기`
                      }
                      onClick={() => toggleExpanded(row.pageId)}
                    >
                      <ChevronDown
                        className={
                          open ? "rotate-180 transition" : "transition"
                        }
                      />
                    </Button>
                  ) : null}
                </div>
                <RowNote row={row} />
                {open ? (
                  <div className="pt-1">
                    <InlineRevisionDiff
                      pageId={row.pageId}
                      beforeId={row.currentRevisionId}
                      afterId={row.restoreRevisionId}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          variant="destructive"
          disabled={selected.length === 0 || tooMany}
          onClick={() => setConfirming(true)}
        >
          고른 문서 {selected.length}개 처리
        </Button>
        {tooMany ? (
          <span className="text-sm text-destructive">
            한 번에 {BULK_REVERT_MAX}개까지 처리할 수 있습니다.
          </span>
        ) : null}
      </div>

      <ReasonDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="일괄 되돌리기"
        description={`고른 문서 ${selected.length}개를 되돌리거나 삭제합니다. 판은 "관리자" 이름으로 남고, 관리 기록에는 한 줄로 남습니다. 여러 문서가 같은 때에 함께 되돌려지므로, 기록을 보는 사람은 이 가명들이 한 사람이라고 짐작할 수 있습니다.`}
        confirmLabel="처리"
        destructive
        onConfirm={async (reason) => {
          const outcomes = await bulkRevert(
            lookupId,
            fromRevisionId,
            selected.map((row) => ({
              pageId: row.pageId,
              currentRevisionId: row.currentRevisionId,
            })),
            reason,
          );
          setResult(describeBulkRevertResult(outcomes, selected.length));
          setExpanded(new Set());
        }}
        onDone={onDone}
      />
    </div>
  );
}

function StatusBadge({ row }: { row: BulkRevertRow }) {
  switch (row.status) {
    case "revert":
      return (
        <Badge variant="secondary">r{row.restoreRevisionId}로 되돌림</Badge>
      );
    case "delete":
      return <Badge variant="destructive">삭제</Badge>;
    case "same":
      return <Badge variant="outline">바뀌는 것 없음</Badge>;
    case "clean":
      return <Badge variant="outline">이미 되돌려짐</Badge>;
    case "hidden":
      return <Badge variant="outline">숨긴 판</Badge>;
    case "conflict":
      return <Badge variant="outline">충돌</Badge>;
    case "deleted":
      return <Badge variant="outline">이미 삭제됨</Badge>;
  }
}

/** 줄 아래의 안내. 관리자가 손으로 할 일이 있으면 알린다. */
function RowNote({ row }: { row: BulkRevertRow }) {
  const notes: string[] = [];
  if (row.status === "conflict") {
    notes.push(
      "이 사람의 편집 뒤에 다른 사람이 편집했습니다. 기록에서 직접 확인해 주세요.",
    );
  }
  if (row.status === "delete") {
    notes.push(
      row.moveLeftover
        ? "이 사람이 문서를 옮기며 옛 이름에 남긴 넘겨주기입니다. 옮겨진 문서를 다시 옮길 때 덮어쓸 수 있어 처음에는 고르지 않습니다."
        : "이 사람이 만든 문서입니다. 삭제한 뒤에도 관리자는 복구할 수 있습니다.",
    );
  }
  if (row.status === "hidden") {
    notes.push(
      `돌아갈 판(r${row.restoreRevisionId})이 숨긴 판이라, 숨긴 내용을 다시 공개하지 않도록 건너뜁니다. 기록에서 직접 고쳐 주세요.`,
    );
  }
  if (row.keptCount > 0) {
    notes.push(
      `이 사람의 앞선 편집 ${row.keptCount}개는 다른 사람의 편집 아래에 있어 되돌린 뒤에도 남습니다. 기록에서 확인해 주세요.`,
    );
  }
  if (row.hasMove) {
    notes.push(
      "이동이 있습니다. 제목은 되돌리지 않으니 필요하면 손으로 다시 옮겨 주세요.",
    );
  }
  if (notes.length === 0) return null;
  return (
    <p className="mt-1 pl-6 text-xs text-muted-foreground">{notes.join(" ")}</p>
  );
}
