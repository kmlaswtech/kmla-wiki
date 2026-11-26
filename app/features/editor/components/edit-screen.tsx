import { useState } from "react";
import { Link } from "react-router";

import type { EditTarget } from "../data/save";
import { EditorForm } from "./editor-form";
import { RedirectForm } from "./redirect-form";
import { ReadOnlyDocument } from "./wiki-editor";
import type { MemberStatus } from "~/features/auth";
import type { ImageInfo } from "~/features/images";
import { findSections, getSection, pageHref } from "~/features/markup";
import type { ResolvedBody } from "~/features/pages";
import { formatDateTime } from "~/shared/lib/time";

/** 편집할 수 없는 이유. 차단은 따로 받는다(`ban`). */
export type EditBlocked = "protected" | "deleted" | "invalid-title";

const BLOCKED_MESSAGE: Record<EditBlocked, string> = {
  protected: "보호된 문서입니다. 관리자만 편집할 수 있습니다.",
  deleted: "삭제된 문서입니다. 관리자에게 복구를 요청해 주세요.",
  "invalid-title": "문서 제목에는 [ ] { } | # < > 문자를 사용할 수 없습니다.",
};

/**
 * 편집 화면 본체. 본문 편집기, 넘겨주기 입력, 읽기 전용 보기 가운데 하나를 보여 준다.
 *
 * 다른 문서·문단·판으로 가면 부르는 쪽이 `key`를 바꾸어 새로 만든다. 편집기는 처음 받은 글로 한 번
 * 만들고, 넘겨주기 입력인지도 새로 정한다.
 */
export function EditScreen({
  target,
  resolved,
  images,
  isNew,
  startAsRedirect,
  blocked,
  ban,
}: {
  target: EditTarget;
  resolved: ResolvedBody;
  images: ReadonlyMap<string, ImageInfo>;
  isNew: boolean;
  startAsRedirect: boolean;
  blocked: EditBlocked | null;
  /** 편집 차단. 실제 차단은 서버가 한다. */
  ban: MemberStatus["ban"];
}) {
  const [redirectMode, setRedirectMode] = useState(startAsRedirect);
  const section =
    target.sectionIndex === null
      ? null
      : findSections(target.baseBody)[target.sectionIndex];
  const readOnly = Boolean(ban) || blocked !== null;
  const savedRedirect = target.baseBody.attrs?.redirect;

  return (
    <div>
      <header className="mb-4 border-b pb-3">
        <h1 className="text-2xl font-bold">
          <Link to={pageHref(target.title)} className="hover:underline">
            {target.title}
          </Link>{" "}
          <span className="font-normal text-muted-foreground">
            {headingLabel({
              redirectMode: redirectMode && !readOnly,
              isNew,
              savedRedirect: Boolean(savedRedirect),
              sectionTitle: section?.title ?? null,
              readOnly,
            })}
          </span>
        </h1>
      </header>

      {ban ? (
        // 실제 차단은 서버가 한다. 여기서는 쓰기 전에 알려 헛수고를 막는다.
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          편집이 차단되었습니다.
          {ban.endsAt
            ? ` (${formatDateTime(ban.endsAt)}까지)`
            : " (기한 없음)"}{" "}
          사유: {ban.reason}
        </p>
      ) : blocked ? (
        <p className="rounded-md border p-4 text-sm">
          {BLOCKED_MESSAGE[blocked]}
        </p>
      ) : null}

      {readOnly ? (
        // 고칠 수 없어도 편집기 모양으로 보여 준다. 골라서 복사하면 다른 문서에 그대로 붙는다.
        isNew ? null : savedRedirect ? (
          <p className="text-sm text-muted-foreground">
            이 문서는{" "}
            <Link
              to={pageHref(savedRedirect)}
              className="text-primary hover:underline"
            >
              {savedRedirect}
            </Link>{" "}
            문서로 넘겨줍니다.
          </p>
        ) : (
          <ReadOnlyDocument
            doc={
              (target.sectionIndex !== null &&
                getSection(target.baseBody, target.sectionIndex)) ||
              target.baseBody
            }
            resolved={resolved}
            images={images}
            ariaLabel={`${target.title} 본문`}
          />
        )
      ) : redirectMode ? (
        <RedirectForm
          target={target}
          onWriteDocument={() => setRedirectMode(false)}
        />
      ) : (
        <>
          <EditNotice />
          <EditorForm
            target={target}
            initialResolved={resolved}
            initialImages={images}
            onConvertToRedirect={() => setRedirectMode(true)}
          />
        </>
      )}
    </div>
  );
}

/** 제목 옆에 붙는 화면 이름. */
function headingLabel({
  redirectMode,
  isNew,
  savedRedirect,
  sectionTitle,
  readOnly,
}: {
  redirectMode: boolean;
  isNew: boolean;
  savedRedirect: boolean;
  sectionTitle: string | null;
  readOnly: boolean;
}): string {
  const verb = readOnly ? "보기" : "편집";
  if (redirectMode) {
    if (isNew) return "넘겨주기로 만들기";
    return savedRedirect ? "넘겨주기 편집" : "넘겨주기로 바꾸기";
  }
  if (isNew) return "새 문서";
  return sectionTitle ? `"${sectionTitle}" 문단 ${verb}` : verb;
}

/**
 * 편집 화면 위의 안내문. 이 위키의 규칙을 쓰는 순간에 보이게 한다.
 * 자세한 내용은 위키:편집 도움말 문서에 두고, 여기에는 꼭 지켜야 할 것만 둔다.
 */
function EditNotice() {
  return (
    <aside
      aria-label="편집 안내"
      className="mb-3 rounded-md border bg-muted/40 px-3 py-2 text-sm"
    >
      <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
        <li>학교 밖에 공개되어도 괜찮은 학교생활 정보만 작성해 주세요.</li>
        <li>
          특정 학생이나 외부인에 관한 문서를 만들거나, 이들을 알아볼 수 있는
          내용을 작성하지 마세요.
        </li>
        <li>
          저장한 편집은 기록에 남습니다. 개인 의견이나 비방은 쓰지 마세요.
        </li>
      </ul>
      <p className="mt-1.5">
        작성하는 방법과 규칙은{" "}
        <Link
          to={pageHref("위키:편집 도움말")}
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline"
        >
          위키:편집 도움말
        </Link>
        에 있습니다.
      </p>
    </aside>
  );
}
