import { EyeOff, ShieldAlert } from "lucide-react";
import { useState } from "react";

import { setPostHidden } from "../data/mutations";
import { canWithdrawPost } from "../model/rules";
import type { DiscussionPost } from "../model/types";
import { PostText } from "./post-text";
import { WithdrawButton } from "./withdraw-button";
import { ReasonDialog } from "~/features/admin";
import { ReportButton } from "~/features/reports";
import { RelativeTime } from "~/shared/components/relative-time";
import { cn } from "~/shared/lib/utils";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/shared/ui/dropdown-menu";

const KIND_LABEL: Partial<Record<DiscussionPost["kind"], string>> = {
  close: "닫음",
  reopen: "다시 엶",
  rename: "제목 바꿈",
};

/**
 * 토론의 글 목록. 내 글 거두기, 남의 글 신고, 관리자의 글 숨기기가 줄마다 붙는다. 토론을 신고하려면
 * 첫 글을 신고한다.
 */
export function DiscussionThread({
  posts,
  pageTitle,
  isAdmin,
  canWrite,
  onAdminDone,
}: {
  posts: readonly DiscussionPost[];
  pageTitle: string;
  isAdmin: boolean;
  /** 차단 중이거나 지운 토론이면 거두기·신고 단추를 내지 않는다. */
  canWrite: boolean;
  onAdminDone: () => void;
}) {
  return (
    <ol className="space-y-3">
      {posts.map((post) => (
        <li key={post.id}>
          <PostCard
            post={post}
            canWithdraw={canWrite && canWithdrawPost(posts, post)}
            // 관리자는 신고하지 않고 바로 숨긴다.
            reportTitle={
              canWrite && !isAdmin && !post.mine && post.state === "visible"
                ? pageTitle
                : null
            }
            isAdmin={isAdmin}
            onAdminDone={onAdminDone}
          />
        </li>
      ))}
    </ol>
  );
}

function PostCard({
  post,
  canWithdraw,
  reportTitle,
  isAdmin,
  onAdminDone,
}: {
  post: DiscussionPost;
  canWithdraw: boolean;
  /** 신고할 수 있으면 문서 제목, 아니면 null. */
  reportTitle: string | null;
  isAdmin: boolean;
  onAdminDone: () => void;
}) {
  const kind = KIND_LABEL[post.kind];
  const conclusion = post.kind === "close";

  return (
    <article
      id={`post-${post.id}`}
      className={cn(
        "rounded-lg border px-4 py-3 text-sm",
        conclusion && "border-primary/40 bg-primary/5",
        post.state !== "visible" && "bg-muted/40",
      )}
    >
      <header className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
        {post.asAdmin ? (
          <Badge>{post.authorName}</Badge>
        ) : (
          <span className="font-mono text-xs">{post.authorName}</span>
        )}
        {post.mine ? <Badge variant="secondary">나</Badge> : null}
        {kind ? (
          <Badge variant={conclusion ? "default" : "outline"}>{kind}</Badge>
        ) : null}
        <a href={`#post-${post.id}`} className="hover:underline">
          <RelativeTime value={post.createdAt} />
        </a>
        <span className="ml-auto flex items-center gap-1">
          {canWithdraw ? (
            <WithdrawButton
              postId={post.id}
              title="뒤에 다른 글이 없을 때만 삭제할 수 있습니다."
            >
              삭제
            </WithdrawButton>
          ) : null}
          {reportTitle !== null ? (
            <ReportButton
              target={{
                kind: "post",
                id: post.id,
                pageTitle: reportTitle,
                authorName: post.authorName,
              }}
            />
          ) : null}
          {isAdmin && post.state !== "withdrawn" ? (
            <PostAdminMenu post={post} onDone={onAdminDone} />
          ) : null}
        </span>
      </header>
      <PostBody post={post} />
    </article>
  );
}

function PostBody({ post }: { post: DiscussionPost }) {
  if (post.state === "visible") return <PostText text={post.body ?? ""} />;
  const notice =
    post.state === "withdrawn"
      ? "작성자가 삭제한 글입니다."
      : "관리자가 숨긴 글입니다.";
  return (
    <>
      <p className="text-muted-foreground italic">{notice}</p>
      {/* 관리자에게는 본문이 온다. 되살릴지 판단할 수 있게 흐리게 보여 준다. */}
      {post.body !== null ? (
        <div className="mt-2 border-l-2 pl-3 text-muted-foreground">
          <PostText text={post.body} />
        </div>
      ) : null}
    </>
  );
}

function PostAdminMenu({
  post,
  onDone,
}: {
  post: DiscussionPost;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const hiding = post.state !== "hidden";
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="글 관리"
            />
          }
        >
          <ShieldAlert />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setOpen(true)}>
            <EyeOff />
            {hiding ? "글 숨기기" : "글 숨김 해제"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title={hiding ? "글 숨기기" : "글 숨김 해제"}
        description={
          hiding
            ? `${post.authorName}의 글을 숨깁니다. 회원에게는 "관리자가 숨긴 글"로 보입니다.`
            : `${post.authorName}의 글을 다시 보이게 합니다.`
        }
        confirmLabel={hiding ? "숨기기" : "숨김 해제"}
        destructive={hiding}
        onConfirm={(reason) => setPostHidden(post.id, hiding, reason)}
        onDone={onDone}
      />
    </>
  );
}
