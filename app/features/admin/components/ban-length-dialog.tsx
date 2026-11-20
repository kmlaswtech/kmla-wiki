import { useState, type ReactNode } from "react";

import {
  BAN_PRESETS,
  BAN_UNITS,
  banInterval,
  CUSTOM_PRESET,
  DEFAULT_BAN_INPUT,
  describeBanLength,
  parseBanLength,
  type BanUnit,
} from "../model/ban-length";
import { ReasonDialog } from "./reason-dialog";
import { Input } from "~/shared/ui/input";
import { Label } from "~/shared/ui/label";
import { NativeSelect, NativeSelectOption } from "~/shared/ui/native-select";

interface BanLengthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** 조치를 실행한다. `length`는 Postgres interval 글이고, `null`이면 기한 없음. */
  onConfirm: (length: string | null, reason: string) => Promise<void>;
  onDone: () => void;
}

/**
 * 차단 기간과 사유를 받는 대화상자(차단, 기간 변경). 자주 쓰는 길이를 고르거나 숫자와 단위를 직접
 * 넣는다. 열 때마다 기본 길이로 돌아간다.
 */
export function BanLengthDialog({
  open,
  onOpenChange,
  onConfirm,
  ...dialog
}: BanLengthDialogProps) {
  const [input, setInput] = useState(DEFAULT_BAN_INPUT);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setInput(DEFAULT_BAN_INPUT);
  }

  const length = parseBanLength(input);
  const custom = input.preset === CUSTOM_PRESET;
  const invalid = custom && input.amount !== "" && length === undefined;

  return (
    <ReasonDialog
      {...dialog}
      open={open}
      onOpenChange={onOpenChange}
      canConfirm={length !== undefined}
      onConfirm={(reason) =>
        length === undefined
          ? Promise.resolve()
          : onConfirm(banInterval(length), reason)
      }
    >
      <div className="grid gap-1.5">
        <Label htmlFor="ban-length">기간</Label>
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            id="ban-length"
            value={input.preset}
            onChange={(event) =>
              setInput({ ...input, preset: event.target.value })
            }
          >
            {BAN_PRESETS.map((option) => (
              <NativeSelectOption key={option.key} value={option.key}>
                {describeBanLength(option.length)}
              </NativeSelectOption>
            ))}
            <NativeSelectOption value={CUSTOM_PRESET}>
              직접 입력
            </NativeSelectOption>
          </NativeSelect>
          {custom ? (
            <>
              <Input
                aria-label="기간 숫자"
                className="w-24"
                inputMode="numeric"
                value={input.amount}
                aria-invalid={invalid || undefined}
                onChange={(event) =>
                  setInput({ ...input, amount: event.target.value })
                }
              />
              <NativeSelect
                aria-label="기간 단위"
                value={input.unit}
                onChange={(event) =>
                  setInput({ ...input, unit: event.target.value as BanUnit })
                }
              >
                {BAN_UNITS.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </>
          ) : null}
        </div>
        {invalid ? (
          <p className="text-xs text-destructive">1 이상의 수를 넣어 주세요.</p>
        ) : null}
      </div>
    </ReasonDialog>
  );
}
