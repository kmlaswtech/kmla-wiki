import { CornerDownRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import type { EditTarget } from "../data/save";
import { redirectDoc } from "../model/doc-io";
import { clearDraft } from "../storage/drafts";
import { TitleInput } from "./title-input";
import { loginHref } from "~/features/auth";
import { docToText, pageHref, parseTitle, titleKey } from "~/features/markup";
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
 * 일반 문서를 넘겨주기로 바꾸는 중이면 사라질 본문의 양을 알린다.
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
  const savedTarget = target.baseBody.attrs?.redirect ?? "";
  const [value, setValue] = useState(savedTarget);
  const [summary, setSummary] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = useTargetCheck(value, target.title);

  // 일반 문서를 넘겨주기로 바꾸는 중이면, 화면에서 사라질 글의 양.
  const droppedLength =
    savedTarget === "" ? docToText(target.baseBody).trim().length : 0;

  const chosen =
    check.status === "ok" || check.status === "unknown" ? check.title : null;
  const unchanged = chosen !== null && chosen === parseTitle(savedTarget);
  const canSave = chosen !== null && !unchanged && !saving;

  async function save() {
    if (!canSave || chosen === null) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await saveRevision({
        title: target.title,
        baseRevisionId: target.baseRevisionId,
        body: redirectDoc(chosen),
        summary,
      });
      // 본문 편집기에서 넘어왔다면 그쪽 임시 저장이 남아 있다. 본문은 이제 쓰지 않는다.
      clearDraft(titleKey(target.title), null);
      await navigate(`${pageHref(saved.title)}?redirect=no`);
    } catch (caught) {
      if (isWikiError(caught, NOT_VERIFIED)) {
        await navigate(
          loginHref(`${location.pathname}${location.search}`, "expired"),
        );
        return;
      }
      setError(
        isWikiError(caught, WRITE_ERROR.conflict)
          ? "그 사이 다른 사람이 이 문서를 고쳤습니다. 새로 고친 뒤 다시 시도해 주세요."
          : describeWriteError(caught),
      );
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
      {droppedLength > 0 ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm break-keep">
          넘겨주기로 바꾸면 지금 본문 {droppedLength.toLocaleString("ko")}자가
          화면에서 사라집니다. 판 기록에는 남아 언제든 되돌릴 수 있습니다.
        </p>
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
        <LinkButton variant="ghost" to={pageHref(target.title)}>
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
