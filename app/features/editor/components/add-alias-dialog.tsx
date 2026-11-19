import { Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { redirectDoc } from "../model/doc-io";
import { loginHref } from "~/features/auth";
import { pageHref, parseTitle, titleKey } from "~/features/markup";
import {
  describeWriteError,
  getTitleInfo,
  REDIRECT_MESSAGE,
  saveRevision,
  WRITE_ERROR,
} from "~/features/pages";
import { isWikiError, NOT_VERIFIED } from "~/shared/supabase/errors";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { Input } from "~/shared/ui/input";
import { Label } from "~/shared/ui/label";
import { Spinner } from "~/shared/ui/spinner";

/** 이미 있는 이름. 그 문서로 가는 링크를 붙여 알린다. */
interface Taken {
  title: string;
  /** 이미 이 문서로 넘겨주는 이름인가. */
  ours: boolean;
}

/**
 * 문서에 다른 이름을 더하는 단추와 대화상자. 그 이름으로 이 문서를 가리키는 넘겨주기 문서를 만든다.
 *
 * 따로 RPC를 두지 않고 새 문서 저장(`saveRevision`)에 넘겨주기 본문을 넘긴다. 권한·제목 규칙은
 * 서버가 판정한다.
 */
export function AddAliasButton({
  title,
  onAdded,
}: {
  /** 넘겨받을 문서(이 문서). */
  title: string;
  onAdded: () => void;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState<Taken | null>(null);

  function reset(next: boolean) {
    setOpen(next);
    if (!next) {
      setName("");
      setError(null);
      setTaken(null);
    }
  }

  async function submit() {
    const alias = parseTitle(name);
    setError(null);
    setTaken(null);
    if (alias === null) {
      setError(REDIRECT_MESSAGE.target!);
      return;
    }
    if (titleKey(alias) === titleKey(title)) {
      setError("이 문서의 이름입니다. 다른 이름을 써 주세요.");
      return;
    }
    setSaving(true);
    try {
      // 있는 이름이면 저장이 충돌로 거절된다. 먼저 찾아 어느 문서인지 알려 준다.
      const existing = await getTitleInfo(alias);
      if (existing) {
        setTaken({
          title: existing.title,
          ours:
            existing.redirectTarget !== null &&
            titleKey(existing.redirectTarget) === titleKey(title),
        });
        return;
      }
      await saveRevision({
        title: alias,
        baseRevisionId: null,
        body: redirectDoc(title),
        summary: `${title} 문서의 다른 이름`,
      });
      reset(false);
      onAdded();
    } catch (caught) {
      if (isWikiError(caught, NOT_VERIFIED)) {
        await navigate(
          loginHref(`${location.pathname}${location.search}`, "expired"),
        );
        return;
      }
      // 확인한 뒤 그 사이에 누가 만들었다.
      if (isWikiError(caught, WRITE_ERROR.conflict)) {
        setTaken({ title: alias, ours: false });
        return;
      }
      setError(describeWriteError(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Plus aria-hidden />
        이름 추가
      </Button>
      <Dialog open={open} onOpenChange={reset}>
        <DialogContent>
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void submit();
            }}
          >
            <DialogHeader>
              <DialogTitle>다른 이름 추가</DialogTitle>
              <DialogDescription className="break-keep">
                이 이름으로 들어오면 {title} 문서로 넘어갑니다. 줄임말, 옛 이름,
                다른 표기를 추가할 때 사용합니다.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-1.5">
              <Label htmlFor="alias-name">이름</Label>
              <Input
                id="alias-name"
                value={name}
                // oxlint-disable-next-line jsx-a11y/no-autofocus -- 대화상자를 열자마자 칠 수 있게 한다.
                autoFocus
                autoComplete="off"
                placeholder="예: 줄임말"
                aria-invalid={error !== null || taken !== null || undefined}
                onChange={(event) => {
                  setName(event.target.value);
                  setError(null);
                  setTaken(null);
                }}
              />
            </div>

            {taken ? (
              <p role="alert" className="text-sm break-keep text-destructive">
                <Link
                  to={`${pageHref(taken.title)}?redirect=no`}
                  className="underline"
                >
                  {taken.title}
                </Link>
                {taken.ours
                  ? "은(는) 이미 이 문서의 다른 이름입니다."
                  : " 문서가 이미 존재합니다. 다른 이름을 작성하거나, 해당 문서를 이 문서로 넘겨주게 고쳐 주세요."}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm break-keep text-destructive">
                {error}
              </p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => reset(false)}
              >
                취소
              </Button>
              <Button type="submit" disabled={saving || name.trim() === ""}>
                {saving ? <Spinner /> : null}
                추가
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
