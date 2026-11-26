/** 판 작성자의 이전 차단 수(`ban_history`). 뜻은 그 SQL 함수의 주석에 있다. */
export interface BanHistory {
  total: number;
  lifted: number;
  active: boolean;
}

/** 차단 창에 보이는 한 줄. 해제가 있으면 `total`도 0이 아니다. */
export function describeBanHistory({
  total,
  lifted,
  active,
}: BanHistory): string {
  let text = total === 0 ? "이전 차단 없음" : `이전 차단 ${total}회`;
  if (lifted > 0) text += ` (그중 해제 ${lifted}회)`;
  return active ? `지금 차단 중 · ${text}` : text;
}
