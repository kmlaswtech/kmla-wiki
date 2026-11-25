import { useState, type ReactNode } from "react";

import { deletePage, restorePage, setProtection } from "../data/mutations";
import { ReasonDialog } from "./reason-dialog";

interface PageAdminActionsOptions {
  page: {
    id: number;
    title: string;
    protection: "open" | "admin";
    deletedAt: string | null;
  };
  /** 이 문서로 오는 넘겨주기 수. 삭제하면 이것들이 끊긴다. */
  aliasCount?: number;
  onDone: () => void;
}

/** 문서 머리의 `⋯` 메뉴에 넣는 항목 하나. */
export interface PageAdminAction {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
}

/**
 * 문서 관리(보호와 삭제·복구). `items`는 문서 머리의 `⋯` 메뉴에 넣고, `dialogs`는 메뉴 바깥에 그린다.
 * 메뉴 안에 두면 메뉴가 닫힐 때 대화상자도 사라지기 때문이다.
 */
export function usePageAdminActions({
  page,
  aliasCount = 0,
  onDone,
}: PageAdminActionsOptions): { items: PageAdminAction[]; dialogs: ReactNode } {
  const [open, setOpen] = useState<"protect" | "delete" | null>(null);
  const close = (next: boolean) =>
    setOpen((current) => (next ? current : null));
  const isProtected = page.protection === "admin";
  const deleted = page.deletedAt !== null;

  const items: PageAdminAction[] = [
    {
      label: isProtected ? "보호 해제" : "문서 보호",
      onSelect: () => setOpen("protect"),
    },
    {
      label: deleted ? "문서 복구" : "문서 삭제",
      onSelect: () => setOpen("delete"),
      destructive: !deleted,
    },
  ];

  const dialogs = (
    <>
      <ReasonDialog
        open={open === "protect"}
        onOpenChange={close}
        title={isProtected ? "보호 해제" : "문서 보호"}
        description={
          isProtected
            ? `‘${page.title}’의 문서별 편집 제한을 해제합니다.`
            : `‘${page.title}’는 관리자만 편집할 수 있습니다.`
        }
        confirmLabel={isProtected ? "보호 해제" : "보호"}
        onConfirm={(reason) =>
          setProtection(page.id, isProtected ? "open" : "admin", reason)
        }
        onDone={onDone}
      />

      <ReasonDialog
        open={open === "delete"}
        onOpenChange={close}
        title={deleted ? "문서 복구" : "문서 삭제"}
        description={
          deleted
            ? `${page.title} 문서와 판 기록을 다시 모두에게 보이게 합니다.`
            : `삭제하면 일반 회원은 ‘${page.title}’와 편집 기록을 볼 수 없습니다. 관리자는 문서를 복구할 수 있습니다.${
                aliasCount > 0
                  ? ` 이 문서로 오는 넘겨주기 ${aliasCount}개가 끊깁니다.`
                  : ""
              }`
        }
        confirmLabel={deleted ? "복구" : "삭제"}
        destructive={!deleted}
        onConfirm={(reason) =>
          deleted ? restorePage(page.id, reason) : deletePage(page.id, reason)
        }
        onDone={onDone}
      />
    </>
  );

  return { items, dialogs };
}
