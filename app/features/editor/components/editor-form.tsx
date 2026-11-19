import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useBlocker, useNavigate } from "react-router";
import { toast } from "sonner";

import { buildFullBody, saveEdit, type EditTarget } from "../data/save";
import { isLargeDeletion } from "../model/conflict";
import { joinDoc, normalizeDoc, splitDoc, type DocMeta } from "../model/doc-io";
import { clearDraft, loadDraft, saveDraft } from "../storage/drafts";
import { DocMetaFields } from "./doc-meta-fields";
import { EditorDialogs } from "./editor-dialogs";
import type { EditorRequest } from "./editor-ui";
import { Toolbar } from "./toolbar";
import { useWikiEditor, WikiEditorContent } from "./wiki-editor";
import { loginHref } from "~/features/auth";
import {
  IMAGE_INPUT_ACCEPT,
  resolveImages,
  uploadImage,
  type ImageInfo,
} from "~/features/images";
import {
  docToText,
  emptyDoc,
  extractRefs,
  getSection,
  NODE,
  namespaceOf,
  pageHref,
  titleKey,
  type WikiDoc,
} from "~/features/markup";
import {
  describeWriteError,
  DiffView,
  resolveBody,
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
  /** 처음 그릴 때 쓸 틀 본문·링크 정보(문서 보기에서 이미 받은 것). */
  initialResolved: ResolvedBody;
  /** 처음 그릴 때 쓸 이미지 정보(편집 화면을 열 때 이미 받은 것). */
  initialImages: ReadonlyMap<string, ImageInfo>;
  /** "넘겨주기로 바꾸기": 넘겨주기 입력(`RedirectForm`)으로 바꾼다. 문단 편집에는 없다. */
  onConvertToRedirect?: () => void;
}

/** 입력이 멈춘 뒤 틀·링크 정보와 임시 저장을 갱신하기까지의 시간. */
const SETTLE_MS = 600;

/** 저장 단축키 안내. 이 화면은 브라우저에서만 그려지므로 `navigator`를 읽어도 된다. */
const SAVE_SHORTCUT =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.userAgent)
    ? "⌘S"
    : "Ctrl+S";

const NO_META: DocMeta = { categories: [] };

/** 편집기에 여는 부분: 문단 편집이면 그 문단, 아니면 문서 전체. */
function editingPart(target: EditTarget): WikiDoc {
  return target.sectionIndex === null
    ? target.baseBody
    : (getSection(target.baseBody, target.sectionIndex) ?? emptyDoc());
}

/**
 * 편집 화면 한 벌: 툴바, 편집기, 분류, 편집 요약, 저장.
 *
 * 넘겨주기는 여기서 고치지 않는다(`RedirectForm`). 넘겨주기 문서를 일반 문서로 바꿔 여는 경우에도
 * 넘겨주기는 빼고 시작한다. 그래서 본문을 쓰고 저장하면 넘겨주기가 풀린다.
 *
 * 편집기가 곧 미리보기다. 고치는 대로 문서 보기와 같은 모양으로 보인다. 원문 차이는 "변경 사항"
 * 탭에서 본다.
 */
export function EditorForm({
  target,
  initialResolved,
  initialImages,
  onConvertToRedirect,
}: EditorFormProps) {
  const navigate = useNavigate();
  const key = titleKey(target.title);
  const sectionMode = target.sectionIndex !== null;

  // 충돌이 나면 최신 판이 새 기준이 된다. 그래서 기준은 props가 아니라 상태다.
  const [base, setBase] = useState(target);
  const [draft] = useState(() => loadDraft(key, target.sectionIndex));
  // 임시 저장도 편집기 스키마로 한 번 읽는다. 그래야 기준 판과 키 순서까지 같은 값이 된다.
  const [initial] = useState(() =>
    splitDoc(normalizeDoc(draft?.body ?? editingPart(target))),
  );

  const [content, setContent] = useState<WikiDoc>(initial.content);
  const [meta, setMeta] = useState<DocMeta>(initial.meta);
  const [summary, setSummary] = useState(draft?.summary ?? "");
  const [resolved, setResolved] = useState(initialResolved);
  const [images, setImages] =
    useState<ReadonlyMap<string, ImageInfo>>(initialImages);
  const [tab, setTab] = useState<"edit" | "changes">("edit");
  const [request, setRequest] = useState<EditorRequest | null>(null);
  const [uploading, setUploading] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<WikiDoc | null>(null);
  const [confirmDeletion, setConfirmDeletion] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [draftNotice, setDraftNotice] = useState(draft !== null);
  const form = useRef<HTMLFormElement>(null);
  /** 저장에 성공했거나 사용자가 버리기로 했을 때 켠다. 그 뒤의 이동은 막지 않는다. */
  const allowLeave = useRef(false);

  /** 지금 편집기의 글(문단 편집이면 그 문단)과 문서 정보를 합친 값. */
  const current = useMemo(
    () => joinDoc(content, sectionMode ? NO_META : meta),
    [content, meta, sectionMode],
  );
  const baseline = useMemo(() => normalizeDoc(editingPart(base)), [base]);
  const baselineJson = useMemo(() => JSON.stringify(baseline), [baseline]);
  // 넘겨주기 문서를 일반 문서로 바꿔 여는 중인가. 기준(`normalizeDoc`)에서 넘겨주기가 빠지므로,
  // 아무것도 쓰지 않으면 바뀐 것이 없다(빈 문서로 저장되거나 임시 저장·나가기 경고가 생기지 않는다).
  const releasingRedirect =
    !sectionMode && Boolean(base.baseBody.attrs?.redirect);
  // 양쪽 다 편집기 스키마를 거친 값이라 키 순서가 같다. 그래서 키를 정렬하지 않고 바로 비교한다
  // (글자를 칠 때마다 계산하므로 큰 문서에서 정렬 비용이 크다).
  const dirty = useMemo(
    () => JSON.stringify(current) !== baselineJson,
    [current, baselineJson],
  );

  // 틀 본문·링크 대상·이미지 정보를 다시 받을 글. 가리키는 것(링크·틀·이미지)이 바뀔 때만 바뀐다.
  // 처음 글의 정보는 화면을 열 때 이미 받았다. 임시 저장을 불러왔으면 글이 다르므로 다시 받는다.
  const [lookup, setLookup] = useState<WikiDoc | null>(() =>
    draft ? current : null,
  );
  const lookupKey = useRef(draft ? null : refsKey(current));

  const editor = useWikiEditor({
    initialContent: initial.content,
    editable: true,
    ariaLabel: `${target.title} 본문`,
    existing: resolved.existing,
    request: setRequest,
    onChange: setContent,
    onImageFiles: (files) => void insertImages(files),
  });

  // 원문 차이(충돌 안내, "변경 사항" 탭)에 쓰는 글자. 차이 계산이 무거워서, 보일 때만 그리고 입력이
  // 잠깐 멈춘 뒤에 다시 계산한다.
  const showsDiff = conflict !== null || tab === "changes";
  const deferredCurrent = useDeferredValue(current);
  const currentText = useMemo(
    () => (showsDiff ? docToText(deferredCurrent) : ""),
    [showsDiff, deferredCurrent],
  );
  const conflictText = useMemo(
    () => (conflict ? docToText(conflict) : ""),
    [conflict],
  );
  const baselineText = useMemo(
    () => (showsDiff ? docToText(baseline) : ""),
    [showsDiff, baseline],
  );

  // 저장 단추·단축키·저장 처리가 함께 쓰는 조건. 이미지를 올리는 중에 저장하면 그 이미지가 빠진다.
  const canSave = dirty && !saving && uploading === 0;

  // 최신 값을 이벤트 처리기(나가기 경고, 단축키)에서 읽는다.
  const latest = useRef({ current, summary, dirty, canSave });
  useEffect(() => {
    latest.current = { current, summary, dirty, canSave };
  });

  /** 지금 쓰고 있는 글을 바로 임시 저장한다. 고친 것이 없으면 남기지 않는다. */
  const flushDraft = useCallback(
    (body: WikiDoc, note: string, changed: boolean) => {
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

  // 입력이 멈추면 임시 저장하고, 틀·링크 정보를 다시 받는다.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextKey = refsKey(current);
      if (nextKey !== lookupKey.current) {
        lookupKey.current = nextKey;
        setLookup(current);
      }
      flushDraft(current, summary, dirty);
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [current, summary, dirty, flushDraft]);

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
      const { current: body, summary: note, dirty: changed } = latest.current;
      if (allowLeave.current || !changed) return;
      flushDraft(body, note, changed);
      event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [flushDraft]);

  // Ctrl/⌘+S, Ctrl/⌘+Enter로 저장. 편집기보다 먼저 받아야 해서 capture 단계에서 듣는다.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const isSave = event.key === "s" || event.key === "S";
      const isEnter = event.key === "Enter";
      if (!isSave && !isEnter) return;
      // Enter는 이 폼 안에서만. Ctrl+S는 어디서 눌러도 브라우저의 "페이지 저장" 대신 문서를 저장한다.
      if (isEnter && !form.current?.contains(event.target as Node)) return;
      // 다른 대화상자(링크 넣기 등)가 열려 있으면 건드리지 않는다.
      if (document.querySelector("[role=dialog]")) return;

      event.preventDefault();
      event.stopPropagation();
      if (latest.current.canSave) form.current?.requestSubmit();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  // 틀 본문·링크 대상의 존재 여부와 이미지 크기·경로. 틀을 넣거나 링크를 걸면 잠시 뒤에 반영된다.
  // 보조 정보라 못 받아도 편집은 계속된다(링크 색이나 이미지 자리만 부정확해진다). 이미지가 없는
  // 글이면 이미지 요청은 나가지 않는다.
  useEffect(() => {
    if (!lookup) return;
    let cancelled = false;
    void resolveBody(lookup).then(
      (next) => !cancelled && setResolved(next),
      () => undefined,
    );
    void resolveImages(lookup).then(
      (next) =>
        !cancelled && setImages((known) => new Map([...known, ...next])),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [lookup]);

  /** 고른·붙여넣은·끌어놓은 이미지를 한 장씩 올려 커서 자리에 넣는다. */
  async function insertImages(files: File[]) {
    for (const file of files) {
      setUploading((count) => count + 1);
      try {
        const uploaded = await uploadImage(file);
        setImages((known) =>
          new Map(known).set(uploaded.id, {
            path: uploaded.path,
            width: uploaded.width,
            height: uploaded.height,
          }),
        );
        editor
          ?.chain()
          .focus()
          .insertContent({
            type: NODE.image,
            attrs: { id: uploaded.id, alt: uploaded.alt },
          })
          .run();
      } catch (caught) {
        toast.error(
          caught instanceof Error
            ? caught.message
            : "이미지를 올리지 못했습니다.",
        );
      } finally {
        setUploading((count) => count - 1);
      }
    }
  }

  /** 편집기와 문서 정보를 주어진 문서로 되돌린다(임시 저장 버리기). */
  function resetTo(doc: WikiDoc) {
    const next = splitDoc(normalizeDoc(doc));
    editor?.commands.setContent(next.content, { emitUpdate: true });
    setContent(next.content);
    setMeta(next.meta);
  }

  async function save(confirmed: boolean) {
    // 저장 단추가 꺼져 있을 때도 요약 칸의 Enter 등으로 들어올 수 있다.
    if (!canSave) return;
    const fullBody = buildFullBody(base, current);
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
      const outcome = await saveEdit(base, current, summary);
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
      const latestPart =
        base.sectionIndex === null
          ? outcome.latest.body
          : getSection(outcome.latest.body, base.sectionIndex);
      if (latestPart === null) {
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
      setConflict(normalizeDoc(latestPart));
    } catch (caught) {
      if (isWikiError(caught, NOT_VERIFIED)) {
        // 쓰던 글은 임시 저장에 있다. 로그인하고 돌아오면 복원된다.
        saveDraft(key, target.sectionIndex, {
          body: current,
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
              resetTo(baseline);
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
          <DiffView before={conflictText} after={currentText} />
        </section>
      ) : null}

      {releasingRedirect ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm break-keep text-muted-foreground">
          넘겨주기 문서를 일반 문서로 바꿉니다. 본문을 쓰고 저장하면 넘겨주기가
          풀립니다.
        </p>
      ) : null}

      <div role="tablist" aria-label="편집과 변경 사항" className="flex gap-1">
        {(["edit", "changes"] as const).map((name) => (
          <Button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            size="sm"
            variant={tab === name ? "secondary" : "ghost"}
            onClick={() => setTab(name)}
          >
            {name === "edit" ? "편집" : "변경 사항"}
          </Button>
        ))}
      </div>

      <div className={cn(tab !== "edit" && "hidden")}>
        {editor ? (
          <Toolbar
            editor={editor}
            request={setRequest}
            onPickImage={() => fileInput.current?.click()}
            isTemplatePage={namespaceOf(target.title) === "template"}
            onConvertToRedirect={
              sectionMode || !onConvertToRedirect
                ? undefined
                : () => {
                    // 쓰던 글은 임시 저장에 남긴다. 본문 편집으로 돌아오면 이어서 쓴다.
                    flushDraft(current, summary, dirty);
                    onConvertToRedirect();
                  }
            }
            className="sticky top-(--site-header-height) z-10"
          />
        ) : null}
        <input
          ref={fileInput}
          type="file"
          accept={IMAGE_INPUT_ACCEPT}
          multiple
          hidden
          aria-label="올릴 이미지"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            // 같은 파일을 다시 골라도 onChange가 오게 비운다.
            event.target.value = "";
            void insertImages(files);
          }}
        />
        <WikiEditorContent
          editor={editor}
          resolved={resolved}
          images={images}
          request={setRequest}
          className="rounded-b-md border border-t-0 bg-background px-4 py-3 focus-within:ring-1 focus-within:ring-ring/50"
        />
        {uploading > 0 ? (
          <p
            role="status"
            className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"
          >
            <Spinner /> 이미지를 올리는 중입니다…
          </p>
        ) : null}
      </div>

      {tab === "changes" ? (
        <section aria-label="변경 사항" className="min-w-0">
          {dirty ? (
            <DiffView before={baselineText} after={currentText} />
          ) : (
            <p className="rounded-md border p-4 text-sm text-muted-foreground">
              아직 바꾼 것이 없습니다.
            </p>
          )}
        </section>
      ) : null}

      {sectionMode ? null : <DocMetaFields meta={meta} onChange={setMeta} />}

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

      {/* 폰에는 저장 단축키가 없다. 아래로 끝까지 내리지 않아도 저장할 수 있게 화면 아래에 붙인다. */}
      <div className="flex items-center gap-2 max-sm:sticky max-sm:bottom-0 max-sm:z-10 max-sm:-mx-4 max-sm:border-t max-sm:bg-background max-sm:px-4 max-sm:py-2">
        <Button type="submit" disabled={!canSave}>
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

      {editor ? (
        <EditorDialogs
          editor={editor}
          request={request}
          onClose={() => setRequest(null)}
        />
      ) : null}

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
                flushDraft(current, summary, dirty);
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

/** 글이 가리키는 것(링크·틀·분류·이미지)의 목록. 같으면 틀·링크·이미지 정보를 다시 받지 않는다. */
function refsKey(doc: WikiDoc): string {
  return extractRefs(doc)
    .map((ref) => `${ref.kind}:${ref.target}`)
    .sort()
    .join("\n");
}
