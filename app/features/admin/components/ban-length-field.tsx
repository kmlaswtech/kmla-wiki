import {
  BAN_PRESETS,
  BAN_UNITS,
  CUSTOM_PRESET,
  describeBanLength,
  parseBanLength,
  type BanLengthInput,
  type BanUnit,
} from "../model/ban-length";
import { Input } from "~/shared/ui/input";
import { Label } from "~/shared/ui/label";
import { NativeSelect, NativeSelectOption } from "~/shared/ui/native-select";

interface BanLengthFieldProps {
  id: string;
  value: BanLengthInput;
  onChange: (value: BanLengthInput) => void;
}

/** 차단 기간 입력. 자주 쓰는 길이를 고르거나, 숫자와 단위를 직접 넣는다. */
export function BanLengthField({ id, value, onChange }: BanLengthFieldProps) {
  const custom = value.preset === CUSTOM_PRESET;
  const invalid = custom && value.amount !== "" && !parseBanLength(value);

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>기간</Label>
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          id={id}
          value={value.preset}
          onChange={(event) =>
            onChange({ ...value, preset: event.target.value })
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
              value={value.amount}
              aria-invalid={invalid || undefined}
              onChange={(event) =>
                onChange({ ...value, amount: event.target.value })
              }
            />
            <NativeSelect
              aria-label="기간 단위"
              value={value.unit}
              onChange={(event) =>
                onChange({ ...value, unit: event.target.value as BanUnit })
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
          1 이상, 10년 안의 기간을 넣어 주세요.
        </p>
      ) : null}
    </div>
  );
}
