import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { banEditor, grantAdmin, setRevisionHidden } from "../data/mutations";
import { ReasonDialog } from "./reason-dialog";
import { Button } from "~/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/shared/ui/dropdown-menu";
import { Label } from "~/shared/ui/label";
import { NativeSelect, NativeSelectOption } from "~/shared/ui/native-select";

interface RevisionAdminMenuProps {
  revision: {
    id: number;
    authorPseudonym: string;
    hiddenAt: string | null;
  };
  pageTitle: string;
  /** 현재 판은 숨길 수 없다. */
  isCurrent: boolean;
  /** 조치가 끝난 뒤 목록을 다시 읽는다. */
  onDone: () => void;
}

const BAN_DAYS = [
  { value: "1", label: "1일" },
  { value: "7", label: "7일" },
  { value: "30", label: "30일" },
  { value: "", label: "기한 없음" },
];

type Open = "ban" | "hide" | "grant" | null;

/**
 * 판 기록의 한 줄에 붙는 관리 메뉴.
 *
 * 차단·관리자 지정의 대상은 "이 판을 쓴 사람"이다. 가명은 문서마다 달라서, 사람을 가리키려면
 * 판을 짚어야 한다. 관리자에게도 그 사람이 누구인지는 보이지 않는다.
 */
export function RevisionAdminMenu({
  revision,
  pageTitle,
  isCurrent,
  onDone,
}: RevisionAdminMenuProps) {
  const [open, setOpen] = useState<Open>(null);
  const [days, setDays] = useState("7");
  const target = `${revision.authorPseudonym} (${pageTitle})`;
  const close = (next: boolean) =>
    setOpen((current) => (next ? current : null));

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={`r${revision.id} 관리`}
            />
          }
        >
          <ShieldAlert />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            render={<Link to={`/admin/author-edits?from=${revision.id}`} />}
          >
            이 사람의 다른 편집 보기
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setOpen("ban")}>
            이 사람 차단
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isCurrent && !revision.hiddenAt}
            onClick={() => setOpen("hide")}
          >
            {revision.hiddenAt ? "판 숨김 해제" : "이 판 숨기기"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setOpen("grant")}>
            관리자로 지정
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ReasonDialog
        open={open === "ban"}
        onOpenChange={close}
        title="편집 차단"
        description={`${target}를 쓴 사람의 편집을 모든 문서에서 막습니다. 열람은 계속할 수 있습니다. 공개 차단 내역에는 이 문서의 가명만 나옵니다.`}
        confirmLabel="차단"
        destructive
        onConfirm={(reason) =>
          banEditor(revision.id, days === "" ? null : Number(days), reason)
        }
        onDone={onDone}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="ban-days">기간</Label>
          <NativeSelect
            id="ban-days"
            value={days}
            onChange={(event) => setDays(event.target.value)}
          >
            {BAN_DAYS.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </ReasonDialog>

      <ReasonDialog
        open={open === "hide"}
        onOpenChange={close}
        title={revision.hiddenAt ? "판 숨김 해제" : "판 숨기기"}
        description={
          revision.hiddenAt
            ? `r${revision.id} 판을 다시 모두에게 보이게 합니다.`
            : `r${revision.id} 판을 일반 사용자에게 보이지 않게 합니다. 실명이 나오는 사건, 비방, 개인정보처럼 기록에 남아 있으면 안 되는 내용에 씁니다. 숨긴 사실과 사유는 공개됩니다.`
        }
        confirmLabel={revision.hiddenAt ? "숨김 해제" : "숨기기"}
        destructive={!revision.hiddenAt}
        onConfirm={(reason) =>
          setRevisionHidden(revision.id, !revision.hiddenAt, reason)
        }
        onDone={onDone}
      />

      <ReasonDialog
        open={open === "grant"}
        onOpenChange={close}
        title="관리자로 지정"
        description={`${target}를 쓴 사람을 관리자로 지정합니다. 공개 기록에는 "관리자 1명을 지정함"으로만 남고, 어떤 가명인지는 남지 않습니다.`}
        confirmLabel="지정"
        onConfirm={(reason) => grantAdmin(revision.id, reason)}
        onDone={onDone}
      />
    </>
  );
}
