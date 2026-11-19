import { Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { redirectDoc } from "../model/doc-io";
import { useLoginOnExpiry } from "~/features/auth";
import { parseTitle, redirectPageHref, titleKey } from "~/features/markup";
import {
  describeWriteError,
  getTitleInfo,
  REDIRECT_MESSAGE,
  saveRevision,
  WRITE_ERROR,
} from "~/features/pages";
import { isWikiError } from "~/shared/supabase/errors";
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

/** 추가하지 못한 까닭. 이미 있는 이름이면 그 문서로 가는 링크를 붙인다. */
type Problem =
  | { kind: "error"; message: string }
  /** `ours`: 이미 이 문서로 넘겨주는 이름. */
  | { kind: "taken"; title: string; ours: boolean };

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
  const [open, setOpen] = useState(false);
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
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          {/* 닫으면 대화상자 안쪽이 사라진다. 다시 열면 칸이 비어 있다. */}
          <AliasForm
            title={title}
            onCancel={() => setOpen(false)}
            onAdded={() => {
              setOpen(false);
              onAdded();
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function AliasForm({
  title,
  onCancel,
  onAdded,
}: {
  title: string;
  onCancel: () => void;
  onAdded: () => void;
}) {
  const loginOnExpiry = useLoginOnExpiry();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  async function submit() {
    const alias = parseTitle(name);
    setProblem(null);
    if (alias === null) {
      setProblem({ kind: "error", message: REDIRECT_MESSAGE.target! });
      return;
    }
    if (titleKey(alias) === titleKey(title)) {
      setProblem({
        kind: "error",
        message: "이 문서의 이름입니다. 다른 이름을 써 주세요.",
      });
      return;
    }
    setSaving(true);
    try {
      await saveRevision({
        title: alias,
        baseRevisionId: null,
        body: redirectDoc(title),
        summary: `${title} 문서의 다른 이름`,
      });
      onAdded();
    } catch (caught) {
      if (await loginOnExpiry(caught)) return;
      setProblem(
        isWikiError(caught, WRITE_ERROR.conflict)
          ? await takenBy(alias, title)
          : { kind: "error", message: describeWriteError(caught) },
      );
    } finally {
      setSaving(false);
    }
  }

  return (
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
          이 이름으로 들어오면 {title} 문서로 넘어갑니다. 줄임말, 옛 이름, 다른
          표기를 추가할 때 사용합니다.
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
          aria-invalid={problem !== null || undefined}
          onChange={(event) => {
            setName(event.target.value);
            setProblem(null);
          }}
        />
      </div>

      {problem ? (
        <p role="alert" className="text-sm break-keep text-destructive">
          {problem.kind === "error" ? (
            problem.message
          ) : (
            <>
              <Link to={redirectPageHref(problem.title)} className="underline">
                {problem.title}
              </Link>
              {problem.ours
                ? "은(는) 이미 이 문서의 다른 이름입니다."
                : " 문서가 이미 존재합니다. 다른 이름을 작성하거나, 해당 문서를 이 문서로 넘겨주게 고쳐 주세요."}
            </>
          )}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          취소
        </Button>
        <Button type="submit" disabled={saving || name.trim() === ""}>
          {saving ? <Spinner /> : null}
          추가
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * 저장이 충돌했다: 그 이름의 문서가 이미 있다. 흔하지 않으니 저장 전에 미리 찾지 않고, 이때만 찾아
 * 어느 문서인지(이미 이 문서로 넘겨주는지) 알려 준다.
 */
async function takenBy(alias: string, title: string): Promise<Problem> {
  const existing = await getTitleInfo(alias).catch(() => null);
  return {
    kind: "taken",
    title: existing?.title ?? alias,
    ours:
      existing?.redirectTarget != null &&
      titleKey(existing.redirectTarget) === titleKey(title),
  };
}
