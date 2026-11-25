import { Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import { useFetcher } from "react-router";

import {
  DISCUSSION_FIELD,
  DISCUSSION_INTENT,
  type DiscussionActionResult,
} from "../model/form";
import { Button } from "~/shared/ui/button";

/** 내 글이나 내 토론을 거두는 단추. 실패하면 단추 옆에 까닭을 보인다. */
export function WithdrawButton({
  postId,
  title,
  icon = <Undo2 />,
  children,
  size = "xs",
  variant = "ghost",
}: {
  /** 있으면 글 하나를, 없으면 토론을 거둔다. */
  postId?: number;
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  size?: "xs" | "sm";
  variant?: "ghost" | "outline";
}) {
  const fetcher = useFetcher<DiscussionActionResult>();
  const failed = fetcher.data && !fetcher.data.ok ? fetcher.data.error : null;
  return (
    <fetcher.Form method="post" className="flex items-center gap-1">
      <input
        type="hidden"
        name={DISCUSSION_FIELD.intent}
        value={
          postId === undefined
            ? DISCUSSION_INTENT.withdrawDiscussion
            : DISCUSSION_INTENT.withdrawPost
        }
      />
      {postId === undefined ? null : (
        <input type="hidden" name={DISCUSSION_FIELD.postId} value={postId} />
      )}
      {failed ? (
        <span role="alert" className="text-xs text-destructive">
          {failed}
        </span>
      ) : null}
      <Button
        type="submit"
        size={size}
        variant={variant}
        disabled={fetcher.state !== "idle"}
        title={title}
      >
        {icon}
        {children}
      </Button>
    </fetcher.Form>
  );
}
