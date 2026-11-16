import { useState } from "react";
import { data, Link, redirect } from "react-router";

import type { Route } from "./+types/author-edits";
import {
  describeAdminError,
  listAuthorEdits,
  RevisionAdminMenu,
  type AuthorEdit,
} from "~/features/admin";
import { loadMemberStatus } from "~/features/auth";
import { pageHref } from "~/features/markup";
import { RevisionList } from "~/features/pages";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";
import { Label } from "~/shared/ui/label";
import { Spinner } from "~/shared/ui/spinner";
import { Textarea } from "~/shared/ui/textarea";

const PAGE_SIZE = 50;

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  // 화면을 가리는 검사다. 실제 권한은 RPC가 검사한다.
  const status = await loadMemberStatus();
  if (!status?.isAdmin) throw redirect("/");

  const from = new URL(request.url).searchParams.get("from") ?? "";
  if (!/^\d+$/.test(from)) throw data(null, { status: 404 });
  return { revisionId: Number(from) };
}

export const meta: Route.MetaFunction = () => [
  { title: "같은 사람의 다른 편집 - 큼온 위키" },
];

/**
 * 판 하나에서 시작해 같은 사람이 다른 문서에 한 편집을 본다(관리자 전용).
 *
 * 문서별 가명이 지키는 것을 관리자에게 한해 푸는 화면이다. 그래서 사유를 먼저 받고, 조회 사실이
 * 공개 기록에 남는다는 것을 조회 전에 알린다. 목록은 주소에 담지 않는다. 새로 고치면 사유부터
 * 다시 적어야 한다.
 */
export default function AuthorEditsRoute({ loaderData }: Route.ComponentProps) {
  const { revisionId } = loaderData;
  const [reason, setReason] = useState("");
  const [edits, setEdits] = useState<AuthorEdit[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(before?: number) {
    setPending(true);
    setError(null);
    try {
      const next = await listAuthorEdits(revisionId, reason, before);
      setEdits((current) => (before ? [...(current ?? []), ...next] : next));
      setHasMore(next.length === PAGE_SIZE);
    } catch (caught) {
      setError(describeAdminError(caught));
    } finally {
      setPending(false);
    }
  }

  const source = edits?.find((edit) => edit.id === revisionId);

  return (
    <div>
      <h1 className="mb-4 border-b pb-3 text-2xl font-bold">
        같은 사람의 다른 편집
      </h1>

      {edits === null ? (
        <form
          className="max-w-xl space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
        >
          <p className="text-sm text-muted-foreground">
            r{revisionId} 판을 쓴 사람이 다른 문서에 한 편집을 봅니다. 여러
            문서에 걸친 훼손을 찾을 때만 씁니다. 조회하면{" "}
            <strong className="text-foreground">
              사유와 함께 공개 관리 기록에 남습니다.
            </strong>{" "}
            이 사람이 누구인지는 보이지 않습니다.
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
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">
              편집 {edits.length}건{hasMore ? " 이상" : ""}. 가명은 문서마다
              다릅니다.
            </span>
            {source ? (
              <span className="ml-auto flex items-center gap-1">
                이 사람에 대한 조치
                <RevisionAdminMenu
                  revision={source}
                  pageTitle={source.pageTitle}
                  isCurrent={source.isCurrent}
                  onDone={() => void load()}
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
              </>
            )}
          />

          {hasMore ? (
            <div className="mt-4 text-center">
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => void load(edits.at(-1)?.id)}
              >
                더 보기
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
