import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

import {
  DISCUSSION_FIELD,
  DISCUSSION_INTENT,
  type DiscussionActionResult,
  type DiscussionIntent,
} from "../model/form";
import {
  closeState,
  DISCUSSION_LIMIT,
  formatRemaining,
  postLength,
} from "../model/rules";
import type { Discussion } from "../model/types";
import { Button } from "~/shared/ui/button";
import { Checkbox } from "~/shared/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { Label } from "~/shared/ui/label";
import { Spinner } from "~/shared/ui/spinner";
import { Textarea } from "~/shared/ui/textarea";

/** 1분마다 바뀌는 현재 시각. 닫기 단추의 남은 시간을 갱신한다. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/**
 * 토론 아래의 글쓰기 칸. 열린 토론은 글 쓰기와 닫기, 닫힌 토론은 다시 열기다. 닫기·다시 열기는
 * 같은 칸에 쓴 글(10자 이상)을 함께 남긴다.
 */
export function DiscussionComposer({
  discussion,
  isAdmin,
}: {
  discussion: Discussion;
  isAdmin: boolean;
}) {
  const fetcher = useFetcher<DiscussionActionResult>();
  const now = useMinuteClock();
  const [body, setBody] = useState("");
  const [asAdmin, setAsAdmin] = useState(false);
  // 닫기·다시 열기는 결론이나 까닭이 남고 되돌리기 어려우므로 한 번 묻는다.
  const [confirming, setConfirming] = useState<
    typeof DISCUSSION_INTENT.close | typeof DISCUSSION_INTENT.reopen | null
  >(null);

  // 보낸 글이 들어가면 칸을 비운다. "관리자로"도 끈다. 다음 글이 모르고 관리자 이름으로 나가지 않게
  // 한다. 새 결과가 올 때 한 번만 한다.
  const result = fetcher.data;
  const [handled, setHandled] = useState(result);
  if (result !== handled) {
    setHandled(result);
    if (result?.ok) {
      setBody("");
      setAsAdmin(false);
    }
  }

  const pending = fetcher.state !== "idle";
  const length = postLength(body);
  const tooLong = length > DISCUSSION_LIMIT.post;
  const longEnough = length >= DISCUSSION_LIMIT.conclusion && !tooLong;
  const close = closeState(discussion, now);
  // 24시간 전에는 '관리자로' 닫을 때만 닫을 수 있다.
  const early = close.kind === "wait";

  function submit(intent: DiscussionIntent) {
    const form = new FormData();
    form.set(DISCUSSION_FIELD.intent, intent);
    form.set(DISCUSSION_FIELD.body, body);
    if (asAdmin) form.set(DISCUSSION_FIELD.asAdmin, "on");
    void fetcher.submit(form, { method: "post" });
  }

  const confirmText =
    confirming === DISCUSSION_INTENT.reopen
      ? {
          title: "토론 다시 열기",
          description:
            "쓴 글이 다시 여는 이유로 남습니다. 24시간 동안은 토론을 다시 연 사람 이외에는 닫을 수 없습니다.",
          action: "다시 열기",
          destructive: false,
        }
      : early
        ? {
            title: "관리자로 일찍 닫기",
            description:
              "토론이 열린 지 24시간이 지나지 않았습니다. 쓴 글이 결론으로 남고, 관리자로 닫으면 공개 관리 기록에 남습니다.",
            action: "닫기",
            destructive: true,
          }
        : {
            title: "토론 닫기",
            description: "작성한 글이 이 토론의 결론으로 남습니다.",
            action: "닫기",
            destructive: false,
          };

  const label = discussion.isOpen
    ? "글 (닫을 때는 결론과 함께 닫아주세요)"
    : "다시 여는 까닭";

  return (
    <section aria-label="글쓰기" className="mt-6 space-y-3 border-t pt-4">
      <div className="grid gap-1.5">
        <Label htmlFor="discussion-composer">{label}</Label>
        <Textarea
          id="discussion-composer"
          value={body}
          rows={4}
          maxLength={DISCUSSION_LIMIT.post}
          onChange={(event) => setBody(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          등록된 글은 수정할 수 없습니다. 뒤에 다른 글이 존재하지 않을 때만
          삭제할 수 있습니다.
          {discussion.isOpen
            ? ` 닫을 때는 결론과 함께 ${DISCUSSION_LIMIT.conclusion}자 이상 작성해야 합니다.`
            : ` 다시 열 때는 ${DISCUSSION_LIMIT.conclusion}자 이상 작성해야 합니다.`}
        </p>
      </div>

      {isAdmin ? (
        <Label className="flex items-center gap-2 font-normal">
          <Checkbox checked={asAdmin} onCheckedChange={setAsAdmin} />
          관리자로 쓰기
        </Label>
      ) : null}

      {result && !result.ok ? (
        <p role="alert" className="text-sm text-destructive">
          {result.error}
        </p>
      ) : null}

      {discussion.isOpen ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            disabled={pending || length === 0 || tooLong}
            onClick={() => submit(DISCUSSION_INTENT.post)}
          >
            {pending ? <Spinner /> : null}글 쓰기
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending || !longEnough || (early && !asAdmin)}
            onClick={() => setConfirming(DISCUSSION_INTENT.close)}
          >
            결론 쓰고 닫기
          </Button>
          {close.kind === "wait" ? (
            <span className="text-xs text-muted-foreground">
              {formatRemaining(close.until, now)} 뒤에 닫을 수 있습니다.
            </span>
          ) : null}
        </div>
      ) : (
        <Button
          type="button"
          disabled={pending || !longEnough}
          onClick={() => setConfirming(DISCUSSION_INTENT.reopen)}
        >
          {pending ? <Spinner /> : null}다시 열기
        </Button>
      )}

      <Dialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmText.title}</DialogTitle>
            <DialogDescription>{confirmText.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming(null)}
            >
              취소
            </Button>
            <Button
              type="button"
              variant={confirmText.destructive ? "destructive" : "default"}
              onClick={() => {
                if (confirming) submit(confirming);
                setConfirming(null);
              }}
            >
              {confirmText.action}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
