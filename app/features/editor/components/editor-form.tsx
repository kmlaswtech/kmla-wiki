import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBlocker, useNavigate } from "react-router";
import { toast } from "sonner";

import { buildFullBody, saveEdit, type EditTarget } from "../data/save";
import { isLargeDeletion } from "../model/conflict";
import { clearDraft, loadDraft, saveDraft } from "../storage/drafts";
import { SourceEditor, type SourceEditorHandle } from "./source-editor";
import { Toolbar } from "./toolbar";
import { loginHref } from "~/features/auth";
import {
  getSection,
  pageHref,
  parseWiki,
  titleKey,
  WikiContent,
} from "~/features/markup";
import {
  describeWriteError,
  DiffView,
  resolveBody,
  suggestTitles,
  type ResolvedBody,
} from "~/features/pages";
import { LinkButton } from "~/shared/components/link-button";
import { cn } from "~/shared/lib/utils";
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

interface EditorFormProps {
  /** 편집을 시작한 문서 상태. */
  target: EditTarget;
  /** 미리보기를 처음 그릴 때 쓸 값(문서 보기에서 이미 받은 것). */
  initialResolved: ResolvedBody;
}

/** 입력이 멈춘 뒤 미리보기와 임시 저장을 갱신하기까지의 시간. */
const SETTLE_MS = 600;

/** 저장 단축키 안내. 이 화면은 브라우저에서만 그려지므로 `navigator`를 읽어도 된다. */
const SAVE_SHORTCUT =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.userAgent)
    ? "⌘S"
    : "Ctrl+S";

/**
 * 편집 화면 한 벌: 툴바, 원문 편집기, 미리보기, 편집 요약, 저장.
 *
 * 데스크톱은 편집기와 미리보기를 나란히, 좁은 화면은 탭으로 번갈아 보여 준다.
 */
export function EditorForm({ target, initialResolved }: EditorFormProps) {
  const navigate = useNavigate();
  const editor = useRef<SourceEditorHandle>(null);
  const key = titleKey(target.title);

  // 충돌이 나면 최신 판이 새 기준이 된다. 그래서 기준은 props가 아니라 상태다.
  const [base, setBase] = useState(target);
  const [draft] = useState(() => loadDraft(key, target.sectionIndex));
  const initialText = useMemo(() => {
    if (draft) return draft.body;
    return target.sectionIndex === null
      ? target.baseBody
      : (getSection(target.baseBody, target.sectionIndex) ?? "");
  }, [draft, target]);

  const [text, setText] = useState(initialText);
  const [summary, setSummary] = useState(draft?.summary ?? "");
  const [settledText, setSettledText] = useState(initialText);
  const [resolved, setResolved] = useState(initialResolved);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [confirmDeletion, setConfirmDeletion] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [draftNotice, setDraftNotice] = useState(draft !== null);
  const form = useRef<HTMLFormElement>(null);
  /** 저장에 성공했거나 사용자가 버리기로 했을 때 켠다. 그 뒤의 이동은 막지 않는다. */
  const allowLeave = useRef(false);

  const baseText =
    base.sectionIndex === null
      ? base.baseBody
      : (getSection(base.baseBody, base.sectionIndex) ?? "");
  const dirty = text !== baseText;

  // 최신 값을 이벤트 처리기(나가기 경고, 단축키)에서 읽는다.
  const latest = useRef({ text, summary, dirty, saving });
  useEffect(() => {
    latest.current = { text, summary, dirty, saving };
  });

  /** 지금 쓰고 있는 글을 바로 임시 저장한다. 고친 것이 없으면 남기지 않는다. */
  const flushDraft = useCallback(
    (body: string, note: string, changed: boolean) => {
      if (changed || note !== "") {
        saveDraft(key, target.sectionIndex, {
          body,
          summary: note,
          baseRevisionId: base.baseRevisionId,
        });
      } else {
        clearDraft(key, target.sectionIndex);
      }
    },
    [key, target.sectionIndex, base.baseRevisionId],
  );

  // 입력이 멈추면 임시 저장하고, 미리보기에 필요한 틀·링크 정보를 다시 받는다.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSettledText(text);
      flushDraft(text, summary, dirty);
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [text, summary, dirty, flushDraft]);

  // 사이트 안에서 다른 화면으로 갈 때. 쓰던 글은 임시 저장에 남는다고 알리고 확인을 받는다.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !allowLeave.current &&
      latest.current.dirty &&
      currentLocation.pathname + currentLocation.search !==
        nextLocation.pathname + nextLocation.search,
  );

  // 탭을 닫거나 새로 고칠 때. 브라우저 기본 경고를 띄우고, 마지막 입력까지 임시 저장한다.
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      const { text: body, summary: note, dirty: changed } = latest.current;
      if (allowLeave.current || !changed) return;
      flushDraft(body, note, changed);
      event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [flushDraft]);

  // Ctrl/⌘+S, Ctrl/⌘+Enter로 저장. 편집기(CodeMirror)보다 먼저 받아야 해서 capture 단계에서 듣는다.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const isSave = event.key === "s" || event.key === "S";
      const isEnter = event.key === "Enter";
      if (!isSave && !isEnter) return;
      // Enter는 이 폼 안에서만. Ctrl+S는 어디서 눌러도 브라우저의 "페이지 저장" 대신 문서를 저장한다.
      if (isEnter && !form.current?.contains(event.target as Node)) return;
      // 다른 대화상자(표 넣기 등)가 열려 있으면 건드리지 않는다.
      if (document.querySelector("[role=dialog]")) return;

      event.preventDefault();
      event.stopPropagation();
      const { dirty: changed, saving: busy } = latest.current;
      if (changed && !busy) form.current?.requestSubmit();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    resolveBody(settledText)
      .then((next) => {
        if (!cancelled) setResolved(next);
      })
      // 미리보기 보조 정보를 못 받아도 편집은 계속된다. 링크 색만 부정확해진다.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [settledText]);

  const preview = useMemo(
    () => parseWiki(settledText, { templates: resolved.templates }),
    [settledText, resolved.templates],
  );

  async function save(confirmed: boolean) {
    if (saving) return;
    const fullBody = buildFullBody(base, text);
    if (
      !confirmed &&
      fullBody !== null &&
      isLargeDeletion(base.baseBody, fullBody)
    ) {
      setConfirmDeletion(true);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const outcome = await saveEdit(base, text, summary);
      if (outcome.status === "saved") {
        clearDraft(key, target.sectionIndex);
        allowLeave.current = true;
        if (outcome.rebased) {
          toast.success(
            "그 사이 다른 문단이 바뀌어, 최신 판에 합쳐 저장했습니다.",
          );
        }
        await navigate(pageHref(outcome.saved.title));
        return;
      }

      // 내 글은 편집기에 그대로 둔다. 최신 판을 새 기준으로 삼고 차이를 보여 준다.
      const latestSection =
        base.sectionIndex === null
          ? outcome.latest.body
          : getSection(outcome.latest.body, base.sectionIndex);
      if (latestSection === null) {
        setError(
          "그 사이 문단 구성이 바뀌어 문단 편집을 이어 갈 수 없습니다. 쓰던 글을 복사해 두고 전체 편집으로 다시 시도해 주세요.",
        );
        return;
      }
      setBase({
        ...base,
        baseRevisionId: outcome.latest.revisionId,
        baseBody: outcome.latest.body,
      });
      setConflict(latestSection);
    } catch (caught) {
      if (isWikiError(caught, NOT_VERIFIED)) {
        // 쓰던 글은 임시 저장에 있다. 로그인하고 돌아오면 복원된다.
        saveDraft(key, target.sectionIndex, {
          body: text,
          summary,
          baseRevisionId: base.baseRevisionId,
        });
        allowLeave.current = true;
        await navigate(
          loginHref(`${location.pathname}${location.search}`, "expired"),
        );
        return;
      }
      setError(describeWriteError(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      ref={form}
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save(false);
      }}
    >
      {draftNotice ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          <span>이 브라우저에 남아 있던, 저장하지 않은 글을 불러왔습니다.</span>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => {
              clearDraft(key, target.sectionIndex);
              editor.current?.replaceAll(baseText);
              setSummary("");
              setDraftNotice(false);
            }}
          >
            버리고 현재 판으로
          </Button>
        </div>
      ) : null}

      {conflict !== null ? (
        <section className="space-y-2 rounded-md border border-destructive/40 p-3">
          <h2 className="font-semibold">다른 사람이 먼저 고쳤습니다</h2>
          <p className="text-sm text-muted-foreground">
            아래는 최신 판(−)과 내 글(+)의 차이입니다. 다른 사람이 고친 내용이
            빠지지 않게 편집기에서 맞춘 뒤 다시 저장해 주세요. 지금 그대로
            저장하면 아래 차이대로 저장됩니다.
          </p>
          <DiffView before={conflict} after={text} />
        </section>
      ) : null}

      <div
        role="tablist"
        aria-label="편집과 미리보기"
        className="flex gap-1 lg:hidden"
      >
        {(["edit", "preview"] as const).map((name) => (
          <Button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            size="sm"
            variant={tab === name ? "secondary" : "ghost"}
            onClick={() => setTab(name)}
          >
            {name === "edit" ? "편집" : "미리보기"}
          </Button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={cn(tab !== "edit" && "hidden lg:block")}>
          <Toolbar editor={editor} />
          <SourceEditor
            ref={editor}
            initialValue={initialText}
            onChange={setText}
            suggest={suggestTitles}
            ariaLabel={`${target.title} 본문`}
          />
        </div>
        <section
          aria-label="미리보기"
          className={cn(
            "min-w-0 rounded-md border p-4",
            tab !== "preview" && "hidden lg:block",
          )}
        >
          {settledText.trim() === "" ? (
            <p className="text-sm text-muted-foreground">
              쓴 내용이 여기에 보입니다.
            </p>
          ) : (
            <WikiContent document={preview} existing={resolved.existing} />
          )}
        </section>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="edit-summary">편집 요약 (선택)</Label>
        <Input
          id="edit-summary"
          type="text"
          value={summary}
          maxLength={200}
          placeholder="무엇을 왜 고쳤는지 한 줄로"
          onChange={(event) => setSummary(event.target.value)}
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={saving || !dirty}>
          {saving ? <Spinner /> : null}
          저장
        </Button>
        <LinkButton
          variant="ghost"
          onClick={(event) => {
            if (dirty) {
              // 쓰던 글을 한 번의 실수로 잃지 않게, 버리기 전에 묻는다.
              event.preventDefault();
              setConfirmDiscard(true);
              return;
            }
            clearDraft(key, target.sectionIndex);
          }}
          to={pageHref(target.title)}
        >
          취소
        </LinkButton>
        <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">
          <kbd className="font-sans">{SAVE_SHORTCUT}</kbd>로 저장
        </span>
      </div>

      <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>쓰던 글을 버릴까요?</DialogTitle>
            <DialogDescription>
              저장하지 않은 내용과 이 브라우저의 임시 저장이 모두 사라집니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmDiscard(false)}
            >
              계속 쓰기
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setConfirmDiscard(false);
                clearDraft(key, target.sectionIndex);
                allowLeave.current = true;
                void navigate(pageHref(target.title));
              }}
            >
              버리고 나가기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => {
          if (!open && blocker.state === "blocked") blocker.reset();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>편집을 그만두고 나갈까요?</DialogTitle>
            <DialogDescription>
              쓰던 글은 이 브라우저에 임시 저장되어, 이 문서를 다시 편집하면
              이어서 쓸 수 있습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => blocker.reset?.()}
            >
              계속 편집
            </Button>
            <Button
              type="button"
              onClick={() => {
                flushDraft(text, summary, dirty);
                blocker.proceed?.();
              }}
            >
              나가기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDeletion} onOpenChange={setConfirmDeletion}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>내용을 절반 넘게 지웁니다</DialogTitle>
            <DialogDescription>
              이 편집은 문서의 절반 이상을 지웁니다. 의도한 것이 맞다면 편집
              요약에 이유를 적어 주세요. 판 기록에서 언제든 되돌릴 수 있습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmDeletion(false)}
            >
              다시 보기
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setConfirmDeletion(false);
                void save(true);
              }}
            >
              그대로 저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
