import { ShieldAlert, Trash2 } from "lucide-react";
import { useState } from "react";

import { setDiscussionDeleted } from "../data/mutations";
import { canWithdrawDiscussion } from "../model/rules";
import type { Discussion } from "../model/types";
import { WithdrawButton } from "./withdraw-button";
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
