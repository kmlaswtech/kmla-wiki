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
  const [confirmEarly, setConfirmEarly] = useState(false);

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

  const label = discussion.isOpen
    ? "글 (닫을 때는 이 글이 결론이 됩니다)"
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
          글은 고칠 수 없습니다. 뒤에 다른 글이 없을 때만 거둘 수 있습니다.
          {discussion.isOpen
            ? ` 닫을 때는 ${DISCUSSION_LIMIT.conclusion}자 이상 써야 합니다.`
            : ` 다시 열 때는 ${DISCUSSION_LIMIT.conclusion}자 이상 써야 합니다.`}
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
            onClick={() =>
              early ? setConfirmEarly(true) : submit(DISCUSSION_INTENT.close)
            }
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
          onClick={() => submit(DISCUSSION_INTENT.reopen)}
        >
          {pending ? <Spinner /> : null}다시 열기
        </Button>
      )}

      <Dialog open={confirmEarly} onOpenChange={setConfirmEarly}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>관리자로 일찍 닫기</DialogTitle>
            <DialogDescription>
              토론이 열린 지 24시간이 지나지 않았습니다. 관리자로 닫으면 공개
              관리 기록에 남고, 결론 글의 앞부분이 사유로 적힙니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmEarly(false)}
            >
              취소
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setConfirmEarly(false);
                submit(DISCUSSION_INTENT.close);
              }}
            >
              닫기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
