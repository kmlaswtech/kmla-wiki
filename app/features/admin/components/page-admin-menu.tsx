import { ShieldAlert } from "lucide-react";
import { useState } from "react";

import { deletePage, restorePage, setProtection } from "../data/mutations";
import { ReasonDialog } from "./reason-dialog";
import { Button } from "~/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/shared/ui/dropdown-menu";

interface PageAdminMenuProps {
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

/** 문서에 붙는 관리 메뉴: 보호와 삭제·복구. */
export function PageAdminMenu({
  page,
  aliasCount = 0,
  onDone,
}: PageAdminMenuProps) {
  const [open, setOpen] = useState<"protect" | "delete" | null>(null);
  const close = (next: boolean) =>
    setOpen((current) => (next ? current : null));
  const isProtected = page.protection === "admin";
  const deleted = page.deletedAt !== null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label="문서 관리"
            />
          }
        >
          <ShieldAlert />
          {/* 좁은 화면에서는 아이콘만 둔다(이름은 `aria-label`). */}
          <span className="max-sm:hidden">관리</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setOpen("protect")}>
            {isProtected ? "보호 해제" : "문서 보호"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setOpen("delete")}>
            {deleted ? "문서 복구" : "문서 삭제"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
}
