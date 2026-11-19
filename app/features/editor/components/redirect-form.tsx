import { CornerDownRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { loadLatest, type EditTarget } from "../data/save";
import { redirectDoc, sameDoc } from "../model/doc-io";
import { clearDraft, loadDraft } from "../storage/drafts";
import { TitleInput } from "./title-input";
import { loginHref } from "~/features/auth";
import {
  pageHref,
  parseTitle,
  titleKey,
  visibleTextLength,
  type WikiDoc,
} from "~/features/markup";
import {
  describeWriteError,
  getTitleInfo,
  saveRevision,
  WRITE_ERROR,
  type TitleInfo,
} from "~/features/pages";
import { LinkButton } from "~/shared/components/link-button";
import { isWikiError, NOT_VERIFIED } from "~/shared/supabase/errors";
import { Button } from "~/shared/ui/button";
import { Input } from "~/shared/ui/input";
import { Label } from "~/shared/ui/label";
import { Spinner } from "~/shared/ui/spinner";

/** 대상 칸에 쓴 이름의 상태. 있는 일반 문서일 때만 저장할 수 있다. */
type TargetCheck =
  | { status: "empty" | "invalid" | "self" | "checking" | "missing" }
  | { status: "ok"; title: string }
  | { status: "redirect"; title: string; next: string }
  /** 확인하지 못했다. 저장은 막지 않는다(DB가 대상의 존재까지 요구하지는 않는다). */
  | { status: "unknown"; title: string };

/**
 * 넘겨주기 문서 편집. 본문 편집기 대신 대상 하나만 고른다.
 *
 * 넘겨주기를 따라가면 넘겨주기 문서의 본문은 아무도 보지 못한다. 그래서 본문 칸을 두지 않는다.
 * 저장하면 사라지는 것(지금 판의 본문·분류, 본문 편집기에서 쓰던 글)을 미리 알린다.
 */
export function RedirectForm({
  target,
  onWriteDocument,
}: {
  target: EditTarget;
  /** "일반 문서로 쓰기": 본문 편집기로 바꾼다. */
  onWriteDocument: () => void;
}) {
  const navigate = useNavigate();
  const key = titleKey(target.title);
  // 충돌이 나면 최신 판이 새 기준이 된다.
  const [base, setBase] = useState(target);
  const savedTarget = base.baseBody.attrs?.redirect ?? "";
  const [value, setValue] = useState(savedTarget);
  const [summary, setSummary] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = useTargetCheck(value, base.title);

  const [dropped] = useState(() => droppedContent(base.baseBody, key));

  const chosen =
    check.status === "ok" || check.status === "unknown" ? check.title : null;
  // 대상이 같아도 저장된 본문이 넘겨주기 모양이 아니면(규칙 이전에 본문이 붙은 것) 저장해 정리한다.
  const unchanged =
    chosen !== null && sameDoc(redirectDoc(chosen), base.baseBody);
  const canSave = chosen !== null && !unchanged && !saving;

  async function save() {
    if (!canSave || chosen === null) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await saveRevision({
        title: base.title,
        baseRevisionId: base.baseRevisionId,
        body: redirectDoc(chosen),
        summary,
      });
      // 본문 편집기에서 넘어왔다면 그쪽 임시 저장이 남아 있다. 본문은 이제 쓰지 않는다.
      clearDraft(key, null);
      await navigate(`${pageHref(saved.title)}?redirect=no`);
    } catch (caught) {
      if (isWikiError(caught, NOT_VERIFIED)) {
        await navigate(
          loginHref(`${location.pathname}${location.search}`, "expired"),
        );
        return;
      }
      if (isWikiError(caught, WRITE_ERROR.conflict)) {
        // 최신 판을 새 기준으로 삼는다. 쓴 대상은 그대로 두어 확인 뒤 다시 저장하게 한다.
        const latest = await loadLatest(base.title).catch(() => null);
        if (latest) {
          setBase({
            ...base,
            baseRevisionId: latest.revisionId,
            baseBody: latest.body,
          });
        }
        setError(
          latest
            ? `그 사이 다른 사람이 이 문서를 고쳤습니다${
                latest.body.attrs?.redirect
                  ? `(지금 대상: ${latest.body.attrs.redirect})`
                  : ""
              }. 확인한 뒤 다시 저장해 주세요.`
            : "그 사이 다른 사람이 이 문서를 고쳤습니다. 새로 고친 뒤 다시 시도해 주세요.",
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
      className="max-w-xl space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {dropped.length > 0 ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm break-keep">
          <p>넘겨주기로 저장하면</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {dropped.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-1.5">
        <Label htmlFor="redirect-target" className="flex items-center gap-1.5">
          <CornerDownRight className="size-4" aria-hidden />
          넘겨줄 문서
        </Label>
        <p className="text-xs text-muted-foreground">
          이 이름으로 들어오면 아래 문서로 바로 넘어갑니다. 줄임말, 옛 이름,
          다른 표기를 한 문서로 모을 때 씁니다.
        </p>
        <TitleInput
          id="redirect-target"
          value={value}
          onChange={setValue}
          placeholder="문서 이름"
          aria-invalid={
            check.status === "invalid" ||
            check.status === "self" ||
            check.status === "missing" ||
            undefined
          }
          aria-describedby="redirect-target-status"
        />
        <TargetStatus check={check} onUseNext={setValue} />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="redirect-summary">편집 요약 (선택)</Label>
        <Input
          id="redirect-summary"
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

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={!canSave}>
          {saving ? <Spinner /> : null}
          저장
        </Button>
        <LinkButton variant="ghost" to={pageHref(base.title)}>
          취소
        </LinkButton>
        <Button
          type="button"
          variant="outline"
          className="ml-auto"
          onClick={onWriteDocument}
        >
          {savedTarget === "" ? "본문 편집으로 돌아가기" : "일반 문서로 바꾸기"}
        </Button>
      </div>
    </form>
  );
}

/**
 * 넘겨주기로 저장하면 사라지는 것. 지금 판의 본문·분류는 판 기록에 남지만, 본문 편집기에서 쓰다가
 * 넘어온 글(임시 저장)은 저장한 적이 없어 남지 않는다.
 */
function droppedContent(baseBody: WikiDoc, key: string): string[] {
  const lines: string[] = [];
  const storedLength = visibleTextLength(baseBody);
  if (storedLength > 0) {
    lines.push(
      `지금 판의 본문 ${storedLength.toLocaleString("ko")}자가 화면에서 사라집니다(판 기록에는 남습니다).`,
    );
  }
  const categories = baseBody.attrs?.categories?.length ?? 0;
  if (categories > 0) {
    lines.push(`분류 ${categories}개가 빠집니다.`);
  }
  // 본문 편집기에서 쓰다가 넘어왔다면 임시 저장이 있다. 넘겨주기로 저장하면 지운다.
  const draft = loadDraft(key, null);
  const draftLength = draft ? visibleTextLength(draft.body) : 0;
  if (draftLength > 0) {
    lines.push(
      `저장하지 않고 쓰던 글 ${draftLength.toLocaleString("ko")}자는 지워지고, 판 기록에도 남지 않습니다.`,
    );
  }
  return lines;
}

/** 쓴 이름이 쓸 수 있는 대상인지. 입력이 잠깐 멈추면 DB에서 확인한다. */
function useTargetCheck(value: string, ownTitle: string): TargetCheck {
  const title = parseTitle(value);
  const self = title !== null && titleKey(title) === titleKey(ownTitle);
  const [found, setFound] = useState<{
    title: string;
    info: TitleInfo | null | "error";
  } | null>(null);

  useEffect(() => {
    if (title === null || self) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      getTitleInfo(title).then(
        (info) => !cancelled && setFound({ title, info }),
        () => !cancelled && setFound({ title, info: "error" }),
      );
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [title, self]);

  if (value.trim() === "") return { status: "empty" };
  if (title === null) return { status: "invalid" };
  if (self) return { status: "self" };
  if (found?.title !== title) return { status: "checking" };
  if (found.info === "error") return { status: "unknown", title };
  if (found.info === null) return { status: "missing" };
  if (found.info.redirectTarget !== null) {
    return {
      status: "redirect",
      title: found.info.title,
      next: found.info.redirectTarget,
    };
  }
  return { status: "ok", title: found.info.title };
}

function TargetStatus({
  check,
  onUseNext,
}: {
  check: TargetCheck;
  onUseNext: (title: string) => void;
}) {
  const id = "redirect-target-status";
  switch (check.status) {
    case "empty":
      return <p id={id} className="sr-only" aria-live="polite" />;
    case "checking":
      return (
        <p
          id={id}
          aria-live="polite"
          className="flex items-center gap-1.5 text-sm text-muted-foreground"
        >
          <Spinner /> 문서를 확인하는 중…
        </p>
      );
    case "ok":
      return (
        <p id={id} aria-live="polite" className="text-sm text-muted-foreground">
          있는 문서입니다.
        </p>
      );
    case "unknown":
      return (
        <p id={id} aria-live="polite" className="text-sm text-muted-foreground">
          문서가 있는지 확인하지 못했습니다. 그대로 저장할 수는 있습니다.
        </p>
      );
    case "redirect":
      return (
        <div
          id={id}
          aria-live="polite"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-destructive"
        >
          <span>
            {check.title}도 넘겨주기 문서입니다(→ {check.next}).
          </span>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => onUseNext(check.next)}
          >
            최종 문서로 바꾸기
          </Button>
        </div>
      );
    default:
      return (
        <p id={id} aria-live="polite" className="text-sm text-destructive">
          {STATUS_ERROR[check.status]}
        </p>
      );
  }
}

const STATUS_ERROR: Record<"invalid" | "self" | "missing", string> = {
  invalid:
    "쓸 수 없는 문서 이름입니다. [ ] { } | # < > 는 제목에 쓸 수 없습니다.",
  self: "자기 자신으로 넘겨줄 수 없습니다.",
  missing: "없는 문서입니다. 있는 문서로만 넘겨줄 수 있습니다.",
};
