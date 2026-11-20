/**
 * 차단 기간. 관리자는 길이(3일, 2주)로 고르고, 서버에는 끝나는 시각을 보낸다. 범위(5분 뒤 ~ 10년
 * 안)는 서버(`private.check_ban_end`)가 다시 검사한다.
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

/** 단위마다 넣을 수 있는 가장 큰 수. 10년보다 조금 짧게 잡는다. */
const MAX_AMOUNT: Record<BanUnit, number> = {
  hour: 24 * 365 * 10 - 1,
  day: 365 * 10 - 3,
  week: 52 * 10 - 1,
  month: 12 * 10 - 1,
};

/** 입력을 길이로. 올바르지 않으면 `undefined`. */
export function parseBanLength(input: BanLengthInput): BanLength | undefined {
  if (input.preset !== CUSTOM_PRESET) {
    const preset = BAN_PRESETS.find((option) => option.key === input.preset);
    return preset ? preset.length : undefined;
  }
  if (!/^\d+$/.test(input.amount.trim())) return undefined;
  const amount = Number(input.amount);
  if (amount < 1 || amount > MAX_AMOUNT[input.unit]) return undefined;
  return { amount, unit: input.unit };
}

/** 끝나는 시각(ISO). 기한 없음은 `null`. */
export function banEndsAt(length: BanLength, now: number): string | null {
  if (length === null) return null;
  const end = new Date(now);
  switch (length.unit) {
    case "hour":
      end.setTime(now + length.amount * 3_600_000);
      break;
    case "day":
      end.setDate(end.getDate() + length.amount);
      break;
    case "week":
      end.setDate(end.getDate() + length.amount * 7);
      break;
    case "month": {
      // 1월 31일 + 1개월은 3월 초가 아니라 2월의 마지막 날이다.
      const day = end.getDate();
      end.setDate(1);
      end.setMonth(end.getMonth() + length.amount);
      const lastDay = new Date(
        end.getFullYear(),
        end.getMonth() + 1,
        0,
      ).getDate();
      end.setDate(Math.min(day, lastDay));
      break;
    }
  }
  return end.toISOString();
}

export function describeBanLength(length: BanLength): string {
  if (length === null) return "기한 없음";
  const unit = BAN_UNITS.find((option) => option.value === length.unit);
  return `${length.amount}${unit?.label ?? ""}`;
}
