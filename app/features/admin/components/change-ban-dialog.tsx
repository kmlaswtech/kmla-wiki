import { useState } from "react";

import { changeBanEnd } from "../data/mutations";
import {
  banEndsAt,
  DEFAULT_BAN_INPUT,
  parseBanLength,
} from "../model/ban-length";
import type { BanEntry } from "../model/log";
import { BanLengthField } from "./ban-length-field";
import { ReasonDialog } from "./reason-dialog";

interface ChangeBanDialogProps {
  /** 바꿀 차단. `null`이면 닫힌다. */
  ban: BanEntry | null;
  onClose: () => void;
  onDone: () => void;
}

/**
 * 진행 중인 차단의 기간을 바꾼다(연장, 단축, 기한 없음으로). 새 기간은 지금부터 센다. 해제했다가
 * 다시 차단하지 않아도 된다.
 */
export function ChangeBanDialog({
  ban,
  onClose,
  onDone,
}: ChangeBanDialogProps) {
  const [input, setInput] = useState(DEFAULT_BAN_INPUT);
  // 닫히는 동안에도 설명이 비지 않게 마지막 차단을 둔다. 다른 차단을 열면 입력을 기본값으로 되돌린다.
  const [shown, setShown] = useState(ban);
  if (ban !== null && ban !== shown) {
    setShown(ban);
    setInput(DEFAULT_BAN_INPUT);
  }
  const length = parseBanLength(input);

  return (
    <ReasonDialog
      open={ban !== null}
      onOpenChange={(open) => !open && onClose()}
      title="차단 기간 변경"
      description={`${shown?.pseudonym ?? ""} (${shown?.pageTitle ?? ""})의 차단이 끝나는 때를 바꿉니다. 새 기간은 지금부터 셉니다.`}
      confirmLabel="변경"
      canConfirm={length !== undefined}
      onConfirm={(reason) =>
        ban
          ? changeBanEnd(ban.id, banEndsAt(length ?? null, Date.now()), reason)
          : Promise.resolve()
      }
      onDone={onDone}
    >
      <BanLengthField
        id="change-ban-length"
        value={input}
        onChange={setInput}
      />
    </ReasonDialog>
  );
}
