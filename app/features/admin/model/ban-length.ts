/**
 * 차단 기간. 관리자는 길이(3일, 2주)로 고르고, 서버에는 Postgres interval 글(`3 day`)로 보낸다.
 * 끝나는 시각과 범위(1시간 ~ 10년)는 서버(`private.ban_end`)가 서버 시계로 정한다.
 */

export type BanUnit = "hour" | "day" | "week" | "month";

/** `null`이면 기한 없음. */
export type BanLength = { amount: number; unit: BanUnit } | null;

export const BAN_UNITS: { value: BanUnit; label: string }[] = [
  { value: "hour", label: "시간" },
  { value: "day", label: "일" },
  { value: "week", label: "주" },
  { value: "month", label: "개월" },
];

/** 자주 쓰는 길이. `key`는 선택 상자의 값이다. */
export const BAN_PRESETS: { key: string; length: BanLength }[] = [
  { key: "1h", length: { amount: 1, unit: "hour" } },
  { key: "1d", length: { amount: 1, unit: "day" } },
  { key: "3d", length: { amount: 3, unit: "day" } },
  { key: "7d", length: { amount: 7, unit: "day" } },
  { key: "30d", length: { amount: 30, unit: "day" } },
  { key: "forever", length: null },
];

export const CUSTOM_PRESET = "custom";

/** 화면 입력 그대로의 값. 직접 입력의 숫자는 문자열로 둔다(빈 칸을 허용한다). */
export interface BanLengthInput {
  preset: string;
  amount: string;
  unit: BanUnit;
}

export const DEFAULT_BAN_INPUT: BanLengthInput = {
  preset: "7d",
  amount: "",
  unit: "day",
};

/** 입력을 길이로. 올바르지 않으면 `undefined`. 10년 상한은 서버가 본다. */
export function parseBanLength(input: BanLengthInput): BanLength | undefined {
  if (input.preset !== CUSTOM_PRESET) {
    const preset = BAN_PRESETS.find((option) => option.key === input.preset);
    return preset ? preset.length : undefined;
  }
  if (!/^\d{1,6}$/.test(input.amount.trim())) return undefined;
  const amount = Number(input.amount);
  return amount < 1 ? undefined : { amount, unit: input.unit };
}

/** 서버에 보낼 Postgres interval 글. 기한 없음은 `null`. */
export function banInterval(length: BanLength): string | null {
  return length === null ? null : `${length.amount} ${length.unit}`;
}

export function describeBanLength(length: BanLength): string {
  if (length === null) return "기한 없음";
  const unit = BAN_UNITS.find((option) => option.value === length.unit);
  return `${length.amount}${unit?.label ?? ""}`;
}
