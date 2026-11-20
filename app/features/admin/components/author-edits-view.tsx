import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { openAuthorLookup } from "../data/mutations";
import {
  AUTHOR_EDITS_PAGE_SIZE,
  getAuthorLookup,
  listAuthorEdits,
  type AuthorEdit,
  type LookupSource,
} from "../data/queries";
import { authorEditsHref } from "../model/author-lookup";
import { bulkRevertHref } from "../model/bulk-revert";
import { describeAdminError } from "../model/log";
import { InlineRevisionDiff } from "./inline-revision-diff";
import { RevisionAdminMenu } from "./revision-admin-menu";
import { pageHref } from "~/features/markup";
import { RevisionList } from "~/features/pages";
import { formatDateTime } from "~/shared/lib/time";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";
import { Label } from "~/shared/ui/label";
import { Spinner } from "~/shared/ui/spinner";
import { Textarea } from "~/shared/ui/textarea";

/** 열린 조회 허가와 첫 쪽(loader가 읽는다). */
interface AuthorLookupView {
  id: string;
  source: LookupSource;
  expiresAt: string;
  edits: AuthorEdit[];
}

/** 사유를 받아 조회 허가를 열고, 허가 ID가 든 주소로 옮긴다. */
export function AuthorLookupForm({
  revisionId,
  expired,
}: {
  revisionId: number;
  expired: boolean;
}) {
  const navigate = useNavigate();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setPending(true);
    setError(null);
    try {
      const lookupId = await openAuthorLookup(revisionId, reason);
      // 허가 ID를 주소에 담는다. 새로 고치거나 돌아와도 같은 목록이 열린다.
      await navigate(authorEditsHref(revisionId, lookupId), { replace: true });
    } catch (caught) {
      setError(describeAdminError(caught));
    } finally {
      // 허가가 열린 뒤에도 loader가 "끝남"을 돌려주면 이 폼이 그대로 남는다.
      setPending(false);
    }
  }

  return (
    <div>
      <Heading />
      <form
        className="max-w-xl space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void open();
        }}
      >
        {expired ? (
          <p role="status" className="text-sm font-medium">
            조회 허가가 끝났습니다. 다시 보려면 사유를 적어 주세요.
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          r{revisionId} 판을 쓴 사람이 다른 문서에 한 편집을 봅니다. 여러 문서에
          걸친 훼손을 찾을 때만 씁니다. 조회하면{" "}
          <strong className="text-foreground">
            사유와 함께 공개 관리 기록에 남습니다.
          </strong>{" "}
          허가는 10분 동안 유지됩니다.
        </p>
        <div className="grid gap-1.5">
          <Label htmlFor="lookup-reason">조회 사유</Label>
          <Textarea
            id="lookup-reason"
            value={reason}
            rows={3}
            maxLength={300}
            required
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={pending || reason.trim().length < 2}>
          {pending ? <Spinner /> : null}
          조회
        </Button>
      </form>
    </div>
  );
}

/** 열린 허가로 본 편집 목록과 "이 사람에 대한 조치". */
export function AuthorEditsResult({
  revisionId,
  lookup,
}: {
  /** 주소의 판. 허가가 끝났을 때 이 판에서 다시 조회한다. */
  revisionId: number;
  lookup: AuthorLookupView;
}) {
  // 처음 값만 loader에서 받고, 그 뒤로는 이 화면이 가진다. 더 보기는 뒤에 붙이고, 조치 뒤에는 근거 판과
  // 불러온 만큼의 목록을 한 번에 다시 읽는다. 그래서 조치를 해도 내려간 위치를 잃지 않는다. 허가가
  // 바뀌면 route가 `key`로 이 화면을 새로 만든다.
  const [source, setSource] = useState(lookup.source);
  const [edits, setEdits] = useState(lookup.edits);
  const [hasMore, setHasMore] = useState(
    lookup.edits.length === AUTHOR_EDITS_PAGE_SIZE,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 바로 전 판과의 비교를 펼친 판들.
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());

  function toggle(id: number) {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  /** `more`면 다음 쪽을 붙이고, 아니면(조치 뒤) 근거 판과 지금까지 불러온 만큼을 다시 읽는다. */
  async function fetchEdits(more: boolean) {
    setPending(true);
    setError(null);
    try {
      if (more) {
        const next = await listAuthorEdits(lookup.id, edits.at(-1)?.id);
        setEdits([...edits, ...next]);
        setHasMore(next.length === AUTHOR_EDITS_PAGE_SIZE);
      } else {
        const limit = Math.max(edits.length, AUTHOR_EDITS_PAGE_SIZE);
        const [fresh, rows] = await Promise.all([
          getAuthorLookup(lookup.id),
          listAuthorEdits(lookup.id, undefined, limit),
        ]);
        setSource(fresh.source);
        setEdits(rows);
        setHasMore(rows.length === limit);
      }
    } catch (caught) {
      setError(describeAdminError(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <Heading />
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">
          편집 {edits.length}건{hasMore ? " 이상" : ""}. 가명은 문서마다
          다릅니다. 조회 허가는 {formatDateTime(lookup.expiresAt)}까지입니다.
        </span>
        <span className="ml-auto flex items-center gap-1">
          <Link
            to={bulkRevertHref(lookup.id, revisionId)}
            className="rounded px-1.5 py-0.5 text-primary hover:bg-muted"
          >
            일괄 되돌리기
          </Link>
          이 사람에 대한 조치
          <RevisionAdminMenu
            revision={source}
            pageTitle={source.pageTitle}
            isCurrent={source.isCurrent}
            onDone={() => void fetchEdits(false)}
            showAuthorEdits={false}
          />
        </span>
      </div>

      <RevisionList
        revisions={edits}
        pageTitle={(edit) => edit.pageTitle}
        showPage
        detail={(edit) =>
          expanded.has(edit.id) ? (
            <InlineRevisionDiff
              pageId={edit.pageId}
              beforeId={edit.parentRevisionId}
              afterId={edit.id}
            />
          ) : null
        }
        actions={(edit) => {
          const open = expanded.has(edit.id);
          return (
            <>
              {edit.isCurrent ? (
                <Badge variant="secondary">현재 판</Badge>
              ) : null}
              {edit.pageDeleted ? (
                <Badge variant="outline">삭제된 문서</Badge>
              ) : null}
              <Link
                to={pageHref(edit.pageTitle, "history")}
                className="rounded px-1.5 py-0.5 text-primary hover:bg-muted"
              >
                기록
              </Link>
              <Link
                to={bulkRevertHref(lookup.id, revisionId, edit.id)}
                className="rounded px-1.5 py-0.5 text-primary hover:bg-muted"
                aria-label={`r${edit.id}부터 일괄 되돌리기`}
              >
                여기부터 되돌리기
              </Link>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-expanded={open}
                aria-label={
                  open
                    ? `r${edit.id} 비교 접기`
                    : `r${edit.id} 바로 전 판과 비교 펼치기`
                }
                onClick={() => toggle(edit.id)}
              >
                <ChevronDown
                  className={open ? "rotate-180 transition" : "transition"}
                />
              </Button>
            </>
          );
        }}
      />

      {error ? (
        <p role="alert" className="mt-4 text-center text-sm text-destructive">
          {error}{" "}
          <Link
            to={authorEditsHref(revisionId)}
            className="text-primary hover:underline"
          >
            다시 조회
          </Link>
        </p>
      ) : null}

      {hasMore ? (
        <div className="mt-4 text-center">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => void fetchEdits(true)}
          >
            {pending ? <Spinner /> : null}더 보기
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Heading() {
  return (
    <h1 className="mb-4 border-b pb-3 text-2xl font-bold">
      같은 사람의 다른 편집
    </h1>
  );
}
