import { ShieldAlert, Trash2 } from "lucide-react";
import { useState } from "react";
import { useFetcher } from "react-router";

import { setDiscussionDeleted } from "../data/mutations";
import {
  DISCUSSION_FIELD,
  DISCUSSION_INTENT,
  type DiscussionActionResult,
} from "../model/form";
import { canWithdrawDiscussion } from "../model/rules";
import type { Discussion } from "../model/types";
import { ReasonDialog } from "~/features/admin";
import { Button } from "~/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/shared/ui/dropdown-menu";

/** 토론 제목 줄의 단추: 연 사람의 토론 거두기, 관리자의 토론 지우기·되살리기. */
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
        <WithdrawDiscussionButton />
      ) : null}
      {isAdmin ? (
        <DiscussionAdminMenu discussion={discussion} onDone={onAdminDone} />
      ) : null}
    </div>
  );
}

function WithdrawDiscussionButton() {
  const fetcher = useFetcher<DiscussionActionResult>();
  const failed = fetcher.data && !fetcher.data.ok ? fetcher.data.error : null;
  return (
    <fetcher.Form method="post" className="flex items-center gap-1">
      <input
        type="hidden"
        name={DISCUSSION_FIELD.intent}
        value={DISCUSSION_INTENT.withdrawDiscussion}
      />
      {failed ? (
        <span role="alert" className="text-xs text-destructive">
          {failed}
        </span>
      ) : null}
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={fetcher.state !== "idle"}
        title="다른 글이 없을 때만 거둘 수 있습니다. 거둔 토론은 아무에게도 보이지 않습니다."
      >
        <Trash2 />
        토론 거두기
      </Button>
    </fetcher.Form>
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
          <DropdownMenuItem onClick={() => setOpen(true)}>
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
    </>
  );
}
