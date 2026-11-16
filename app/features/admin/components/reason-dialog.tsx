import { useState, type ReactNode } from "react";

import { describeAdminError } from "../model/log";
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

interface ReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** 이 조치가 무엇을 하고 어떻게 기록되는지. */
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** 사유 위에 둘 추가 입력(차단 기간 등). */
  children?: ReactNode;
  /** 조치를 실행한다. 실패하면 던진다. */
  onConfirm: (reason: string) => Promise<void>;
  /** 성공한 뒤(화면 갱신, 이동). */
  onDone: () => void;
}

/**
 * 사유를 받아 관리 조치를 실행하는 대화상자. 모든 관리 조치가 이 하나를 쓴다.
 *
 * 사유는 필수이고 공개 관리 기록에 그대로 남는다. 그 사실을 입력하는 자리에서 알린다.
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  children,
  onConfirm,
  onDone,
}: ReasonDialogProps) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      await onConfirm(reason);
      setReason("");
      onOpenChange(false);
      onDone();
    } catch (caught) {
      setError(describeAdminError(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            // 이 대화상자를 폼 안에서 열어도 바깥 폼이 제출되지 않게 한다.
            event.stopPropagation();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          {children}

          <div className="grid gap-1.5">
            <Label htmlFor="admin-reason">
              사유 (공개 관리 기록에 남습니다)
            </Label>
            <Textarea
              id="admin-reason"
              value={reason}
              maxLength={300}
              required
              rows={3}
              onChange={(event) => setReason(event.target.value)}
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
              variant={destructive ? "destructive" : "default"}
              disabled={pending || reason.trim().length < 2}
            >
              {pending ? <Spinner /> : null}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
