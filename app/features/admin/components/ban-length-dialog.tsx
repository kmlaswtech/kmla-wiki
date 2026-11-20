import { useState } from "react";

import { banEditor } from "../data/mutations";
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
import { ReasonForm, type ActionDialogProps } from "./reason-dialog";
import { Dialog, DialogContent } from "~/shared/ui/dialog";
import { Input } from "~/shared/ui/input";
import { Label } from "~/shared/ui/label";
import { NativeSelect, NativeSelectOption } from "~/shared/ui/native-select";

interface BanLengthDialogProps extends ActionDialogProps {
  /** 조치를 실행한다. `length`는 Postgres interval 글이고, `null`이면 기한 없음. */
  onConfirm: (length: string | null, reason: string) => Promise<void>;
}

/**
 * 판을 쓴 사람을 차단하는 대화상자. `target`은 "가명 (문서)"다. 판 기록의 메뉴와 일괄 되돌리기 화면이
 * 쓴다.
 */
export function BanEditorDialog({
  revisionId,
  target,
  open,
  onOpenChange,
  onDone,
}: {
  revisionId: number;
  target: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  return (
    <BanLengthDialog
      open={open}
      onOpenChange={onOpenChange}
      title="편집 차단"
      description={`${target}를 쓴 사람의 편집을 모든 문서에서 막습니다. 열람은 계속할 수 있습니다.`}
      confirmLabel="차단"
      destructive
      onConfirm={(length, reason) => banEditor(revisionId, length, reason)}
      onDone={onDone}
    />
  );
}

/**
 * 차단 기간과 사유를 받는 대화상자(차단, 기간 변경). 자주 쓰는 길이를 고르거나 숫자와 단위를 직접
 * 넣는다. 열 때마다 기본 길이로 돌아간다.
 */
export function BanLengthDialog({ open, ...form }: BanLengthDialogProps) {
  return (
    <Dialog open={open} onOpenChange={form.onOpenChange}>
      <DialogContent>
        <BanLengthForm {...form} />
      </DialogContent>
    </Dialog>
  );
}

/** 대화상자 안에 있어서 닫힐 때 내려가고, 열 때마다 기본 길이로 시작한다. */
function BanLengthForm({
  onConfirm,
  ...form
}: Omit<BanLengthDialogProps, "open">) {
  const [input, setInput] = useState(DEFAULT_BAN_INPUT);

  const length = parseBanLength(input);
  const custom = input.preset === CUSTOM_PRESET;
  const invalid = custom && input.amount !== "" && length === undefined;

  return (
    <ReasonForm
      {...form}
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
    </ReasonForm>
  );
}
