/** 되돌리기 폼의 필드 이름. 대화상자(`RevertDialog`)와 그 폼을 받는 action이 같이 쓴다. */
export const REVERT_FIELD = {
  revisionId: "revisionId",
  summary: "summary",
} as const;

/** 되돌리기 action이 실패했을 때 돌려주는 값. 성공하면 문서로 보낸다. */
export interface RevertActionError {
  error: string;
}
