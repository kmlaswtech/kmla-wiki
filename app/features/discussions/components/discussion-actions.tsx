import { Pencil, ShieldAlert, Trash2 } from "lucide-react";
import { useState } from "react";

import { renameDiscussion, setDiscussionDeleted } from "../data/mutations";
import { describeDiscussionError } from "../model/errors";
import { canWithdrawDiscussion, DISCUSSION_LIMIT } from "../model/rules";
import type { Discussion } from "../model/types";
import { WithdrawButton } from "./withdraw-button";
import { ReasonDialog } from "~/features/admin";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/shared/ui/dropdown-menu";
import { Input } from "~/shared/ui/input";
import { Label } from "~/shared/ui/label";
import { Spinner } from "~/shared/ui/spinner";

/** 토론 제목 줄의 단추: 연 사람의 토론 거두기, 관리자의 제목 바꾸기·토론 지우기·되살리기. */
export function DiscussionActions({
  discussion,
  isAdmin,
  canWrite,
  onAdminDone,
}: {
  discussion: Discussion;
  isAdmin: boolean;
  canWrite: boolean;
  onAdminDone: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {canWrite && canWithdrawDiscussion(discussion) ? (
        <WithdrawButton
          size="sm"
          variant="outline"
          icon={<Trash2 />}
          title="다른 글이 없을 때만 삭제할 수 있습니다. 삭제한 토론은 아무에게도 보이지 않습니다."
        >
          토론 삭제
        </WithdrawButton>
      ) : null}
      {isAdmin ? (
        <DiscussionAdminMenu discussion={discussion} onDone={onAdminDone} />
      ) : null}
    </div>
  );
}

function DiscussionAdminMenu({
  discussion,
  onDone,
}: {
  discussion: Discussion;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const deleting = !discussion.deleted;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label="토론 관리"
            />
          }
        >
          <ShieldAlert />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {/* 지운 토론에는 글을 남길 수 없으므로 제목도 바꾸지 않는다. */}
          {deleting ? (
            <DropdownMenuItem onClick={() => setRenaming(true)}>
              <Pencil />
              제목 바꾸기
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => setOpen(true)}>
            <Trash2 />
            {deleting ? "토론 지우기" : "토론 되살리기"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title={deleting ? "토론 지우기" : "토론 되살리기"}
        description={
          deleting
            ? `‘${discussion.title}’ 토론을 지웁니다. 관리자에게만 보입니다.`
            : `‘${discussion.title}’ 토론을 다시 보이게 합니다.`
        }
        confirmLabel={deleting ? "지우기" : "되살리기"}
        destructive={deleting}
        onConfirm={(reason) =>
          setDiscussionDeleted(discussion.id, deleting, reason)
        }
        onDone={onDone}
      />
      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent>
          <RenameForm
            discussion={discussion}
            onOpenChange={setRenaming}
            onDone={onDone}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** 새 제목. 대화상자를 열 때마다 지금 제목으로 시작한다. */
function RenameForm({
  discussion,
  onOpenChange,
  onDone,
}: {
  discussion: { id: number; title: string };
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(discussion.title);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = title.trim();

  async function submit() {
    setPending(true);
    setError(null);
    try {
      await renameDiscussion(discussion.id, trimmed);
      onOpenChange(false);
      onDone();
    } catch (caught) {
      setError(describeDiscussionError(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>토론 제목 바꾸기</DialogTitle>
        <DialogDescription>
          토론에 내 관리자 이름(예: ‘관리자 B’)으로 앞 제목과 새 제목이 글로
          남습니다.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="discussion-new-title">새 제목</Label>
        <Input
          id="discussion-new-title"
          value={title}
          maxLength={DISCUSSION_LIMIT.title}
          required
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
        >
          취소
        </Button>
        <Button
          type="submit"
          disabled={
            pending || trimmed.length === 0 || trimmed === discussion.title
          }
        >
          {pending ? <Spinner /> : null}바꾸기
        </Button>
      </DialogFooter>
    </form>
  );
}
