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

/** 대화상자 껍데기와 조치 설명. 차단 기간 대화상자도 같은 것을 받는다. */
export interface ActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** 이 조치가 무엇을 하고 어떻게 기록되는지. */
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** 성공한 뒤(화면 갱신, 이동). */
  onDone: () => void;
}

interface ReasonDialogProps extends ActionDialogProps {
  /** 조치를 실행한다. 실패하면 던진다. */
  onConfirm: (reason: string) => Promise<void>;
}

/**
 * 사유를 받아 관리 조치를 실행하는 대화상자. 모든 관리 조치가 이 하나를 쓴다.
 *
 * 사유는 필수이고 공개 관리 기록에 그대로 남는다. 그 사실을 입력하는 자리에서 알린다.
 */
export function ReasonDialog({ open, ...form }: ReasonDialogProps) {
  return (
    <Dialog open={open} onOpenChange={form.onOpenChange}>
      <DialogContent>
        <ReasonForm {...form} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * 사유 입력과 확인 단추. `DialogContent` 안에 두면 대화상자가 닫힐 때 함께 내려가므로, 열 때마다 빈
 * 사유로 시작한다(취소한 뒤 다른 대상에 열어도 앞의 사유가 남지 않는다).
 */
export function ReasonForm({
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  children,
  canConfirm = true,
  onConfirm,
  onDone,
}: Omit<ReasonDialogProps, "open"> & {
  /** 사유 위에 둘 추가 입력(차단 기간 등). */
  children?: ReactNode;
  /** 추가 입력이 올바르지 않으면 `false`. */
  canConfirm?: boolean;
}) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      await onConfirm(reason);
      onOpenChange(false);
      onDone();
    } catch (caught) {
      setError(describeAdminError(caught));
    } finally {
      setPending(false);
    }
  }

  return (
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
        <Label htmlFor="admin-reason">사유 (공개 관리 기록에 남습니다)</Label>
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
          disabled={pending || !canConfirm || reason.trim().length < 2}
        >
          {pending ? <Spinner /> : null}
          {confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
