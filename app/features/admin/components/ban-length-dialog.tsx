import { useEffect, useState } from "react";

import { banEditor } from "../data/mutations";
import { getBanHistory } from "../data/queries";
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
      description={
        <>
          {`대상 · ${target}. 선택한 판의 작성자는 모든 문서에서 편집이 차단됩니다. 문서는 계속 읽을 수 있습니다.`}
          <BanHistoryNote revisionId={revisionId} />
        </>
      }
      confirmLabel="차단"
      destructive
      onConfirm={(length, reason) => banEditor(revisionId, length, reason)}
      onDone={onDone}
    />
  );
}

/**
 * 그 사람이 전에 받은 차단 수. 여러 번 차단된 사람에게 더 긴 기간을 고를 수 있게 한다. 대화상자를 열
 * 때 마운트되어 한 번 읽는다. 읽지 못해도 차단은 할 수 있으므로 오류는 짧게만 알린다.
 */
function BanHistoryNote({ revisionId }: { revisionId: number }) {
  const [text, setText] = useState("이전 차단 기록을 확인하는 중");

  useEffect(() => {
    let cancelled = false;
    getBanHistory(revisionId).then(
      ({ total, lifted }) => {
        if (cancelled) return;
        if (total === 0) setText("이전 차단 없음");
        else if (lifted === 0) setText(`이전 차단 ${total}회`);
        else setText(`이전 차단 ${total}회 (그중 해제 ${lifted}회)`);
      },
      () => {
        if (!cancelled) setText("이전 차단 기록을 불러오지 못했습니다.");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [revisionId]);

  return (
    <span className="mt-1 block font-medium text-foreground" aria-live="polite">
      {text}
    </span>
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
                aria-label="차단 기간 값"
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
          <p className="text-xs text-destructive">
            차단 기간은 1 이상이어야 합니다.
          </p>
        ) : null}
      </div>
    </ReasonForm>
  );
}
