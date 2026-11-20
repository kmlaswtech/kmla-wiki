import { useState } from "react";
import { Link } from "react-router";

import { openAuthorLookup } from "../data/mutations";
import {
  AUTHOR_EDITS_PAGE_SIZE,
  listAuthorEdits,
  type AuthorEdit,
} from "../data/queries";
import { describeAdminError } from "../model/log";
import { RevisionAdminMenu } from "./revision-admin-menu";
import { pageHref } from "~/features/markup";
import { RevisionList } from "~/features/pages";
import { formatDateTime } from "~/shared/lib/time";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";
import { Label } from "~/shared/ui/label";
import { Spinner } from "~/shared/ui/spinner";
import { Textarea } from "~/shared/ui/textarea";

/** 열린 조회 허가와 첫 쪽. */
export interface AuthorLookupView {
  id: string;
  sourceRevisionId: number;
  expiresAt: string;
  edits: AuthorEdit[];
}

/**
 * 같은 사람의 다른 편집 화면(관리자 전용).
 *
 * 문서별 가명이 지키는 것을 관리자에게 한해 푸는 화면이다. 그래서 사유를 먼저 받고, 조회 사실이
 * 공개 기록에 남는다는 것을 조회 전에 알린다.
 */
export function AuthorLookupForm({
  revisionId,
  expired,
  onOpened,
}: {
  revisionId: number;
  expired: boolean;
  /** 허가가 열렸다. 그 ID를 주소에 담는다. */
  onOpened: (lookupId: string) => Promise<void> | void;
}) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setPending(true);
    setError(null);
    try {
      await onOpened(await openAuthorLookup(revisionId, reason));
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
          허가는 10분 동안 유지되고, 이 사람이 누구인지는 보이지 않습니다.
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

export function AuthorEditsResult({
  lookup,
  retryHref,
  onChanged,
}: {
  lookup: AuthorLookupView;
  /** 허가가 끝났을 때 다시 조회하는 곳. */
  retryHref: string;
  /** 관리 조치가 끝났다. 첫 쪽을 다시 읽는다. */
  onChanged: () => void;
}) {
  // 첫 쪽은 loader가 읽고, 더 보기로 읽은 쪽은 그 첫 쪽에 묶어 둔다. loader가 다시 읽으면(조치 뒤)
  // 묶음이 맞지 않으므로 붙인 쪽은 버려진다.
  const [loaded, setLoaded] = useState({
    base: lookup.edits,
    pages: [] as AuthorEdit[][],
  });
  const pages = loaded.base === lookup.edits ? loaded.pages : [];
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const edits = [lookup.edits, ...pages].flat();
  const lastPageFull =
    (pages.at(-1) ?? lookup.edits).length === AUTHOR_EDITS_PAGE_SIZE;
  const source = edits.find((edit) => edit.id === lookup.sourceRevisionId);

  async function loadMore() {
    setPending(true);
    setError(null);
    try {
      const next = await listAuthorEdits(lookup.id, edits.at(-1)?.id);
      setLoaded({ base: lookup.edits, pages: [...pages, next] });
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
          편집 {edits.length}건{lastPageFull ? " 이상" : ""}. 가명은 문서마다
          다릅니다. 조회 허가는 {formatDateTime(lookup.expiresAt)}까지입니다.
        </span>
        {source ? (
          <span className="ml-auto flex items-center gap-1">
            이 사람에 대한 조치
            <RevisionAdminMenu
              revision={source}
              pageTitle={source.pageTitle}
              isCurrent={source.isCurrent}
              onDone={onChanged}
            />
          </span>
        ) : null}
      </div>

      <RevisionList
        revisions={edits}
        pageTitle={(edit) => edit.pageTitle}
        showPage
        actions={(edit) => (
          <>
            {edit.isCurrent ? <Badge variant="secondary">현재 판</Badge> : null}
            {edit.pageDeleted ? (
              <Badge variant="outline">삭제된 문서</Badge>
            ) : null}
            <Link
              to={pageHref(edit.pageTitle, "history")}
              className="rounded px-1.5 py-0.5 text-primary hover:bg-muted"
            >
              기록
            </Link>
          </>
        )}
      />

      {error ? (
        <p role="alert" className="mt-4 text-center text-sm text-destructive">
          {error}{" "}
          <Link to={retryHref} className="text-primary hover:underline">
            다시 조회
          </Link>
        </p>
      ) : null}

      {lastPageFull ? (
        <div className="mt-4 text-center">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => void loadMore()}
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
