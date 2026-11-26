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
  clearSelection,
  describeBulkRevertResult,
  firstEditSince,
  isSelectable,
  markProcessed,
  selectedRows,
  type BulkRevertOutcome,
  type BulkRevertRow,
} from "../model/bulk-revert";
import { describeAdminError } from "../model/log";
import { InlineRevisionDiff } from "./inline-revision-diff";
import { BanEditorDialog } from "./ban-length-dialog";
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
  /** 시작점 판의 문서와 시각. 범위가 맞는지 관리자가 확인한다. */
  fromEdit: { pageTitle: string; createdAt: string } | null;
  rows: BulkRevertRow[];
  /** 마지막 실행의 요약. 라우트가 가진다(다시 읽을 때 허가가 끝나도 남게). */
  result: string | null;
  onResult: (summary: string) => void;
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
  fromEdit,
  rows: loadedRows,
  result,
  onResult,
  onDone,
}: BulkRevertViewProps) {
  const navigate = useNavigate();
  // 관리자가 바꾼 칸(문서 id → 고름). 나머지는 기본값을 따른다. 다시 읽은 뒤 고를 수 없게 된 줄은
  // 저절로 빠진다.
  const [overrides, setOverrides] = useState<ReadonlyMap<number, boolean>>(
    new Map(),
  );
  // 이 화면에서 처리한 문서와 결과. 다시 읽은 줄에 덧씌운다(`markProcessed`).
  const [processed, setProcessed] = useState<
    ReadonlyMap<number, BulkRevertOutcome>
  >(new Map());
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [banning, setBanning] = useState(false);
  const [banned, setBanned] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = markProcessed(loadedRows, processed);
  const selected = selectedRows(rows, overrides);
  const selectedIds = new Set(selected.map((row) => row.pageId));
  const selectableCount = rows.filter(isSelectable).length;
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
        setError("선택한 시간대에 작성자의 편집이 없습니다.");
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
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-muted-foreground">
            대상 · ‘{source.pageTitle}’의 가명 ‘{source.authorPseudonym}’으로
            편집한 작성자. {formatDateTime(expiresAt)}까지 조회 가능.
          </p>
          {banned ? (
            <span role="status">차단했습니다.</span>
          ) : (
            <Button
              size="xs"
              variant="outline"
              onClick={() => setBanning(true)}
            >
              작성자 차단
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">
            범위:{" "}
            {fromRevisionId === null
              ? "모든 편집"
              : `r${fromRevisionId}${
                  fromEdit
                    ? `(${fromEdit.pageTitle}, ${formatDateTime(fromEdit.createdAt)})`
                    : ""
                }부터의 편집`}
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
            목록에서 시작 판 선택
          </Link>
        </div>
        <p className="text-muted-foreground">
          문서마다 시작점 직전 판의 내용으로 되돌립니다. 이동한 문서의 제목은
          유지됩니다.
        </p>
      </div>

      {result ? (
        <p role="status" className="mb-3 rounded-md bg-muted px-3 py-2 text-sm">
          작업 완료 · {result}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {rows.length >= BULK_REVERT_PREVIEW_LIMIT ? (
        <p role="status" className="mb-3 text-sm">
          최근에 편집한 문서 {BULK_REVERT_PREVIEW_LIMIT}개까지 표시합니다.
          처리한 뒤 다음 문서를 확인할 수 있습니다.
        </p>
      ) : null}
      {selectableCount > 0 ? (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <span>
            {selected.length}개 선택됨{" / "}선택 가능 {selectableCount}개
          </span>
          <Button
            size="xs"
            variant="outline"
            onClick={() => setOverrides(new Map())}
          >
            모두 선택
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => setOverrides(clearSelection(rows))}
          >
            전체 선택 해제
          </Button>
          {selectableCount > BULK_REVERT_MAX ? (
            <span className="text-muted-foreground">
              목록 위에서부터 최대 {BULK_REVERT_MAX}개를 자동 선택합니다. 처리
              후 다음 문서를 선택합니다.
            </span>
          ) : null}
        </div>
      ) : null}
      {rows.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground">
          선택한 범위에서 되돌릴 편집이 없습니다.
        </p>
      ) : (
        <ul className="divide-y rounded-md border text-sm">
          {rows.map((row) => {
            const selectable = isSelectable(row);
            const checked = selectedIds.has(row.pageId);
            const open = expanded.has(row.pageId);
            return (
              <li key={row.pageId} className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="checkbox"
                    aria-label={`‘${row.pageTitle}’ 선택`}
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
          선택한 문서 {selected.length}개 적용
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
        description={`선택한 문서 ${selected.length}개를 되돌리거나 삭제합니다. 새 판의 작성자는 내 관리자 이름(예: ‘관리자 B’)으로 표시되며, 관리 기록에도 그 이름으로 한 건 남습니다. 여러 문서가 동시에 변경되므로 기록을 보는 사람이 문서별 가명을 같은 작성자로 추정할 수 있습니다.`}
        confirmLabel="처리"
        destructive
        onConfirm={async (reason) => {
          const results = await bulkRevert(
            lookupId,
            fromRevisionId,
            selected.map((row) => ({
              pageId: row.pageId,
              currentRevisionId: row.currentRevisionId,
            })),
            reason,
          );
          setProcessed((current) => {
            const next = new Map(current);
            for (const { pageId, outcome } of results)
              next.set(pageId, outcome);
            return next;
          });
          onResult(
            describeBulkRevertResult(
              results.map((item) => item.outcome),
              selected.length,
            ),
          );
          setExpanded(new Set());
        }}
        onDone={onDone}
      />

      <BanEditorDialog
        open={banning}
        onOpenChange={setBanning}
        revisionId={sourceRevisionId}
        target={`${source.authorPseudonym} (${source.pageTitle})`}
        onDone={() => setBanned(true)}
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
      return <Badge variant="outline">변경 없음</Badge>;
    case "clean":
      return <Badge variant="outline">이미 되돌려짐</Badge>;
    case "hidden":
      return <Badge variant="outline">숨긴 판</Badge>;
    case "conflict":
      return <Badge variant="outline">충돌</Badge>;
    case "deleted":
      return <Badge variant="outline">삭제됨</Badge>;
    case "reverted":
      return <Badge variant="outline">되돌리기 완료</Badge>;
  }
}

/** 줄 아래의 안내. 관리자가 손으로 할 일이 있으면 알린다. */
function RowNote({ row }: { row: BulkRevertRow }) {
  const notes: string[] = [];
  if (row.status === "conflict") {
    notes.push(
      "작성자의 편집 뒤에 다른 편집이 있습니다. 편집 기록에서 확인해 주세요.",
    );
  }
  if (row.status === "delete") {
    notes.push(
      row.moveLeftover
        ? "문서 이동 시 이전 제목에 남긴 넘겨주기입니다. 이동으로 대체할 수 있어 자동 선택에서 제외합니다."
        : "이 사람이 만든 문서입니다. 삭제한 뒤에도 관리자는 복구할 수 있습니다.",
    );
  }
  if (row.status === "hidden") {
    notes.push(
      `되돌릴 판 r${row.restoreRevisionId}가 숨겨져 있어 이 문서를 건너뜁니다. 편집 기록에서 확인해 주세요.`,
    );
  }
  if (row.keptCount > 0) {
    notes.push(
      `다른 작성자가 그 뒤에 편집한 기록이 있어 앞선 편집 ${row.keptCount}건은 남습니다.`,
    );
  }
  if (row.hasMove) {
    notes.push(
      "문서 이동 기록이 있습니다. 제목을 되돌리려면 문서 이동 기능을 사용해 주세요.",
    );
  }
  if (notes.length === 0) return null;
  return (
    <p className="mt-1 pl-6 text-xs text-muted-foreground">{notes.join(" ")}</p>
  );
}
