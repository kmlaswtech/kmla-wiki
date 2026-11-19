import { useState } from "react";
import { Link, useFetcher } from "react-router";

import { pageHref } from "~/features/markup";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { Input } from "~/shared/ui/input";
import { Label } from "~/shared/ui/label";
import { Spinner } from "~/shared/ui/spinner";

/**
 * 되돌리기 전에 묻고, 사유(선택)를 받는다.
 *
 * 지금 화면 라우트의 action(`revisionId`, `summary`)으로 보낸다. 실패하면 action이 `{ error }`를
 * 돌려준다.
 */
export function RevertDialog({
  title,
  revisionId,
  currentRevisionId,
  onClose,
}: {
  title: string;
  revisionId: number | null;
  currentRevisionId: number | null;
  onClose: () => void;
}) {
  const fetcher = useFetcher<{ error?: string }>();
  const [summary, setSummary] = useState("");
  const busy = fetcher.state !== "idle";
  const autoSummary = `r${revisionId} 판으로 되돌림`;

  return (
    <Dialog
      open={revisionId !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent>
        <fetcher.Form method="post" className="contents">
          <input type="hidden" name="revisionId" value={revisionId ?? ""} />
          <DialogHeader>
            <DialogTitle>r{revisionId} 판으로 되돌릴까요?</DialogTitle>
            <DialogDescription>
              지금 판의 내용을 r{revisionId} 판 내용으로 바꾼 새 판이 생깁니다.
              기록은 지워지지 않아 다시 되돌릴 수 있습니다.{" "}
              {currentRevisionId !== null && revisionId !== null ? (
                <Link
                  to={`${pageHref(title, "diff")}?from=${Math.min(revisionId, currentRevisionId)}&to=${Math.max(revisionId, currentRevisionId)}`}
                  className="text-primary hover:underline"
                >
                  지금 판과 비교
                </Link>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5">
            <Label htmlFor="revert-summary">사유 (선택)</Label>
            <Input
              id="revert-summary"
              name="summary"
              type="text"
              value={summary}
              maxLength={150}
              placeholder="왜 되돌리는지 한 줄로"
              onChange={(event) => setSummary(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              편집 요약: {autoSummary}
              {summary.trim() ? `: ${summary.trim()}` : ""}
            </p>
          </div>

          {fetcher.data?.error ? (
            <p role="alert" className="text-sm text-destructive">
              {fetcher.data.error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              그만두기
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner /> : null}
              되돌리기
            </Button>
          </DialogFooter>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
