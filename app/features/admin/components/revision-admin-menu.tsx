import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { grantAdmin } from "../data/mutations";
import { authorEditsHref } from "../model/author-lookup";
import { BanEditorDialog } from "./ban-length-dialog";
import { HideRevisionDialog, hideLabel } from "./hide-revision-dialog";
import { ReasonDialog } from "./reason-dialog";
import { Button } from "~/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/shared/ui/dropdown-menu";

interface RevisionAdminMenuProps {
  revision: {
    id: number;
    authorPseudonym: string;
    /** 생략하면 보이는 판이다. */
    hiddenAt?: string | null;
  };
  pageTitle: string;
  /** 현재 판은 앞 판으로 되돌린 뒤 숨긴다. */
  isCurrent: boolean;
  /** 조치가 끝난 뒤 목록을 다시 읽는다. */
  onDone: () => void;
  /** "작성자의 다른 편집 조회"를 보일지. 그 화면 안에서는 끈다. */
  showAuthorEdits?: boolean;
}

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
  showAuthorEdits = true,
}: RevisionAdminMenuProps) {
  const [open, setOpen] = useState<Open>(null);
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
          {showAuthorEdits ? (
            <DropdownMenuItem
              render={<Link to={authorEditsHref(revision.id)} />}
            >
              작성자의 다른 편집 조회
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => setOpen("ban")}>
            작성자 차단
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setOpen("hide")}>
            {hideLabel(isCurrent, revision.hiddenAt)}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setOpen("grant")}>
            관리자로 지정
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <BanEditorDialog
        open={open === "ban"}
        onOpenChange={close}
        revisionId={revision.id}
        target={target}
        onDone={onDone}
      />

      <HideRevisionDialog
        open={open === "hide"}
        onOpenChange={close}
        revision={revision}
        isCurrent={isCurrent}
        onDone={onDone}
      />

      <ReasonDialog
        open={open === "grant"}
        onOpenChange={close}
        title="관리자로 지정"
        description={`${target}를 쓴 사람을 관리자로 지정합니다. 누가 관리자로 등록되었는지는 남지 않습니다.`}
        confirmLabel="지정"
        onConfirm={(reason) => grantAdmin(revision.id, reason)}
        onDone={onDone}
      />
    </>
  );
}
