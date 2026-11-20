import { Flag } from "lucide-react";
import { useState } from "react";

import { reportRevision } from "../data/mutations";
import {
  canSubmitReport,
  describeReportError,
  REPORT_CATEGORIES,
  REPORT_NOTE_MAX,
  type ReportCategory,
} from "../model/report";
import { Button } from "~/shared/ui/button";
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

/**
 * 판 하나를 관리자에게 알리는 단추. 내용을 고치는 일은 누구나 할 수 있으므로, 회원이 직접 할 수 없는
 * 일(기록에서 판 숨기기, 차단, 보호)을 부탁할 때 쓴다.
 */
export function ReportButton({
  revisionId,
  pageTitle,
  size = "icon-xs",
}: {
  revisionId: number;
  pageTitle: string;
  /** 판 기록의 줄은 작게, 문서 제목 줄은 옆 단추에 맞춘다. */
  size?: "icon-xs" | "icon-sm";
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        size={size}
        variant="ghost"
        aria-label={`r${revisionId} 신고`}
        title="신고"
        onClick={() => setOpen(true)}
      >
        <Flag />
      </Button>
      {/* 닫히면 내려가므로 열 때마다 빈 폼으로 시작한다. */}
      <DialogContent>
        <ReportForm
          revisionId={revisionId}
          pageTitle={pageTitle}
          onClose={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ReportForm({
  revisionId,
  pageTitle,
  onClose,
}: {
  revisionId: number;
  pageTitle: string;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>신고가 접수되었습니다</DialogTitle>
          <DialogDescription>
            신고 내용은 관리자만 확인하며, 신고자 정보는 관리자에게도 표시되지
            않습니다.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            닫기
          </Button>
        </DialogFooter>
      </>
    );
  }

  async function submit() {
    if (category === null) return;
    setPending(true);
    setError(null);
    try {
      await reportRevision(revisionId, category, note);
      setSent(true);
    } catch (caught) {
      setError(describeReportError(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>신고</DialogTitle>
        <DialogDescription>
          신고 대상 · ‘{pageTitle}’ r{revisionId}. 판 숨김이나 편집 차단 등 관리
          조치가 필요할 때 신고해 주세요.
        </DialogDescription>
      </DialogHeader>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">신고 유형</legend>
        {REPORT_CATEGORIES.map((entry) => (
          <label
            key={entry.value}
            className="flex cursor-pointer items-start gap-2 text-sm"
          >
            <input
              type="radio"
              name="report-category"
              value={entry.value}
              checked={category === entry.value}
              onChange={() => setCategory(entry.value)}
              className="mt-0.5 size-4 accent-primary coarse:size-5"
            />
            <span>
              {entry.label}
              {entry.hint ? (
                <span className="block text-xs text-muted-foreground">
                  {entry.hint}
                </span>
              ) : null}
            </span>
          </label>
        ))}
      </fieldset>

      <div className="grid gap-1.5">
        <Label htmlFor="report-note">
          상세 내용{category === "other" ? "" : " (선택)"}
        </Label>
        <Textarea
          id="report-note"
          value={note}
          rows={3}
          maxLength={REPORT_NOTE_MAX}
          onChange={(event) => setNote(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          신고하려는 판의 개인정보를 여기에 옮겨 적지 마세요.
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          취소
        </Button>
        <Button
          type="submit"
          disabled={pending || !canSubmitReport(category, note)}
        >
          {pending ? <Spinner /> : null}
          신고
        </Button>
      </DialogFooter>
    </form>
  );
}
