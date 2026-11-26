import { useState } from "react";
import { Link, useFetcher } from "react-router";

import { REVERT_FIELD, type RevertActionError } from "../model/revert";
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
 * 지금 화면 라우트의 action으로 보낸다. 필드 이름과 실패 응답은 `model/revert.ts`를 따른다.
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
  const fetcher = useFetcher<RevertActionError>();
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
          <input
            type="hidden"
            name={REVERT_FIELD.revisionId}
            value={revisionId ?? ""}
          />
          <DialogHeader>
            <DialogTitle>r{revisionId}로 되돌릴까요?</DialogTitle>
            <DialogDescription>
              r{revisionId}의 내용이 새 판으로 저장됩니다. 기존 편집 기록은
              남습니다.{" "}
              {currentRevisionId !== null && revisionId !== null ? (
                <Link
                  to={`${pageHref(title, "diff")}?from=${Math.min(revisionId, currentRevisionId)}&to=${Math.max(revisionId, currentRevisionId)}`}
                  className="text-primary hover:underline"
                >
                  최신 판과 비교
                </Link>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5">
            <Label htmlFor="revert-summary">사유 (선택)</Label>
            <Input
              id="revert-summary"
              name={REVERT_FIELD.summary}
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
              취소
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
