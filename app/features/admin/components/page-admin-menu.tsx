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
  onDone: () => void;
}

/** 문서에 붙는 관리 메뉴: 보호와 삭제·복구. */
export function PageAdminMenu({ page, onDone }: PageAdminMenuProps) {
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
            ? `${page.title} 문서를 다시 누구나 고칠 수 있게 합니다.`
            : `${page.title} 문서를 관리자만 고칠 수 있게 합니다.`
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
            : `${page.title} 문서와 판 기록을 일반 사용자에게 보이지 않게 합니다. 기록은 지워지지 않고 관리자가 복구할 수 있습니다.`
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
