import { revertAndHideRevision, setRevisionHidden } from "../data/mutations";
import { ReasonDialog } from "./reason-dialog";

interface HideTarget {
  id: number;
  hiddenAt: string | null;
}

type HideMode = "unhide" | "hide" | "revertAndHide";

/** 숨긴 판은 숨김 해제, 현재 판은 앞의 보이는 판으로 되돌린 뒤 숨기기, 나머지는 숨기기. */
function hideMode(
  revision: Pick<HideTarget, "hiddenAt">,
  isCurrent: boolean,
): HideMode {
  if (revision.hiddenAt) return "unhide";
  return isCurrent ? "revertAndHide" : "hide";
}

const HIDE_PURPOSE =
  "실명이 나오는 사건, 비방, 개인정보처럼 기록에 남아 있으면 안 되는 내용에 사용합니다. 숨긴 사실과 사유는 공개되고, 이 판의 신고는 처리함으로 닫힙니다.";

const MODES: Record<
  HideMode,
  {
    label: string;
    confirmLabel: string;
    describe: (id: number) => string;
    run: (id: number, reason: string) => Promise<void>;
  }
> = {
  unhide: {
    label: "판 숨김 해제",
    confirmLabel: "숨김 해제",
    describe: (id) => `r${id} 판을 다시 모두에게 보이게 합니다.`,
    run: (id, reason) => setRevisionHidden(id, false, reason),
  },
  hide: {
    label: "이 판 숨기기",
    confirmLabel: "숨기기",
    describe: (id) =>
      `r${id} 판을 일반 사용자에게 보이지 않게 합니다. ${HIDE_PURPOSE}`,
    run: (id, reason) => setRevisionHidden(id, true, reason),
  },
  revertAndHide: {
    label: "되돌리고 숨기기",
    confirmLabel: "되돌리고 숨기기",
    describe: (id) =>
      `r${id}은 현재 판이라, 먼저 그 앞의 보이는 판으로 되돌린 뒤 일반 사용자에게 보이지 않게 합니다. 앞에 보이는 판이 없으면 문서를 삭제합니다. ${HIDE_PURPOSE}`,
    run: revertAndHideRevision,
  },
};

/** 메뉴와 단추의 이름. */
export function hideLabel(
  revision: Pick<HideTarget, "hiddenAt">,
  isCurrent: boolean,
): string {
  return MODES[hideMode(revision, isCurrent)].label;
}

/** 판 숨기기와 숨김 해제. 현재 판이면 되돌리고 숨긴다. 숨기면 그 판의 신고가 닫힌다. */
export function HideRevisionDialog({
  open,
  onOpenChange,
  revision,
  isCurrent,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  revision: HideTarget;
  /** 현재 판은 바로 숨길 수 없어서 앞의 보이는 판으로 되돌린 뒤 숨긴다. */
  isCurrent: boolean;
  onDone: () => void;
}) {
  const mode = MODES[hideMode(revision, isCurrent)];
  return (
    <ReasonDialog
      open={open}
      onOpenChange={onOpenChange}
      title={mode.label}
      description={mode.describe(revision.id)}
      confirmLabel={mode.confirmLabel}
      destructive={!revision.hiddenAt}
      onConfirm={(reason) => mode.run(revision.id, reason)}
      onDone={onDone}
    />
  );
}
