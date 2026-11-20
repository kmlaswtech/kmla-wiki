import { changeBanEnd } from "../data/mutations";
import type { BanEntry } from "../model/log";
import { BanLengthDialog } from "./ban-length-dialog";

interface ChangeBanDialogProps {
  /** 바꿀 차단. `null`이면 닫힌다. */
  ban: BanEntry | null;
  onClose: () => void;
  onDone: () => void;
}

/** 진행 중인 차단의 기간을 지금부터 다시 정한다(연장, 단축, 기한 없음으로). */
export function ChangeBanDialog({
  ban,
  onClose,
  onDone,
}: ChangeBanDialogProps) {
  return (
    <BanLengthDialog
      open={ban !== null}
      onOpenChange={(open) => !open && onClose()}
      title="차단 기간 변경"
      description={`${ban?.pseudonym ?? ""} (${ban?.pageTitle ?? ""})의 차단이 끝나는 때를 바꿉니다. 새 기간은 지금부터 셉니다.`}
      confirmLabel="변경"
      onConfirm={(length, reason) =>
        ban ? changeBanEnd(ban.id, length, reason) : Promise.resolve()
      }
      onDone={onDone}
    />
  );
}
