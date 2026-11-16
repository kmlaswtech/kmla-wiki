/** 로그인한 사용자의 위키 이용 상태. 가명은 문서마다 달라서 여기에 없다. */
export interface MemberStatus {
  /** KMLA Online 회원 확인을 한 번이라도 받았는가. */
  isMember: boolean;
  /** 회원 확인이 지금 유효한가. 아니면 아무것도 볼 수 없다. */
  verified: boolean;
  /** 이 시각이 지나면 "큼온으로 로그인"을 다시 거친다. */
  verifiedUntil: string | null;
  isAdmin: boolean;
  /** 차단 중이면 편집만 막힌다. */
  ban: { endsAt: string | null; reason: string } | null;
}
