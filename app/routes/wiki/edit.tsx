import { useState } from "react";
import { Link, useOutletContext } from "react-router";

import type { Route } from "./+types/edit";
import type { WikiShellHandle } from "./gate";
import { nonNegativeInt, titleFromParams } from "./title-param";
import { withVerifiedMember, type MemberStatus } from "~/features/auth";
import {
  EditorForm,
  ReadOnlyDocument,
  RedirectForm,
  type EditTarget,
} from "~/features/editor";
import {
  emptyDoc,
  findSections,
  getSection,
  pageHref,
} from "~/features/markup";
import { canEditPage, getPageView, type ResolvedBody } from "~/features/pages";
import { formatDateTime } from "~/shared/lib/time";

type Blocked = "protected" | "deleted" | "invalid-title";

export async function clientLoader({
  request,
  params,
}: Route.ClientLoaderArgs) {
  const title = titleFromParams(params);
  const searchParams = new URL(request.url).searchParams;
  const sectionParam = searchParams.get("section");
  // `?as=redirect`: 넘겨주기 입력으로 연다(없는 문서에서 "다른 문서로 넘겨주기").
  const asRedirect = searchParams.get("as") === "redirect";

  // 넘겨주기 문서를 고칠 때는 대상이 아니라 그 문서 자체를 연다.
  const view = await withVerifiedMember(request, () =>
    getPageView(title, { followRedirect: false }),
  );

  const empty: ResolvedBody = { templates: new Map(), existing: new Set() };
  if (!view.found) {
    const target: EditTarget = {
      title: view.title ?? title,
      baseRevisionId: null,
      baseBody: emptyDoc(),
      sectionIndex: null,
    };
    return {
      target,
      resolved: empty,
      images: new Map(),
      isNew: true,
      startAsRedirect: asRedirect,
      blocked: (view.validTitle ? null : "invalid-title") as Blocked | null,
    };
  }

  const body = view.revision?.body ?? emptyDoc();
  const requested = nonNegativeInt(sectionParam);
  const sectionIndex =
    requested !== null && findSections(body)[requested] ? requested : null;

  const target: EditTarget = {
    title: view.page.title,
    baseRevisionId: view.page.currentRevisionId,
    baseBody: body,
    sectionIndex,
  };
  const blocked: Blocked | null = canEditPage(view)
    ? null
    : view.page.deletedAt
      ? "deleted"
      : view.page.protection === "admin"
        ? "protected"
        : null;

  // 이미지 크기와 경로도 문서와 함께 왔다. 편집기가 처음부터 이미지 자리를 잡고 그린다.
  return {
    target,
    resolved: view.resolved,
    images: view.images,
    isNew: false,
    // 넘겨주기 문서는 언제나 넘겨주기 입력으로 연다(문단 편집도 없다).
    startAsRedirect:
      Boolean(body.attrs?.redirect) || (asRedirect && sectionIndex === null),
    blocked,
  };
}

/** 바깥 껍데기(`gate.tsx`)에 편집 화면임을 알린다. 폰에서 머리띠와 맨 위·아래로 단추를 비킨다. */
export const handle: WikiShellHandle = { editor: true };

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData?.target.title ?? ""} 편집 - 큼온 위키` }];
}

const BLOCKED_MESSAGE: Record<Blocked, string> = {
  protected: "보호된 문서라 관리자만 편집할 수 있습니다.",
  deleted: "삭제된 문서입니다. 다시 만들려면 관리자에게 복구를 요청해 주세요.",
  "invalid-title":
    "이 제목으로는 문서를 만들 수 없습니다. [ ] { } | # < > 는 제목에 쓸 수 없습니다.",
};

export default function EditRoute({ loaderData }: Route.ComponentProps) {
  const { target } = loaderData;
  // 다른 문서·문단·판으로 가면 화면을 새로 만든다. 편집기는 처음 받은 글로 한 번 만들고, 넘겨주기
  // 입력인지도 새로 정한다.
  return (
    <EditScreen
      key={`${target.title}#${target.sectionIndex}@${target.baseRevisionId}`}
      {...loaderData}
    />
  );
}

function EditScreen({
  target,
  resolved,
  images,
  isNew,
  startAsRedirect,
  blocked,
}: Route.ComponentProps["loaderData"]) {
  const status = useOutletContext<MemberStatus>();
  const [redirectMode, setRedirectMode] = useState(startAsRedirect);
  const section =
    target.sectionIndex === null
      ? null
      : findSections(target.baseBody)[target.sectionIndex];
  const readOnly = Boolean(status.ban) || blocked !== null;
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

      {status.ban ? (
        // 실제 차단은 서버가 한다. 여기서는 쓰기 전에 알려 헛수고를 막는다.
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          편집이 차단된 상태입니다
          {status.ban.endsAt
            ? ` (${formatDateTime(status.ban.endsAt)}까지)`
            : " (기한 없음)"}
          . 사유: {status.ban.reason}
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
        <li>
          학교생활에 관한 정보를 적습니다. 상식선에서 학교 밖에 퍼져도 괜찮은
          내용만 작성합니다.
        </li>
        <li>
          특정 학생 또는 외부인에 대한 문서를 만들거나, 특정할 수 있게 쓰지
          않습니다.
        </li>
        <li>
          저장한 글은 기록에 계속 남습니다. 사견이나 비방글을 작성하지 않습니다.
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
