import { useState } from "react";
import { useOutletContext, useRevalidator } from "react-router";

import type { Route } from "./+types/bans";
import {
  ChangeBanDialog,
  isBanActive,
  liftBan,
  listBans,
  ReasonDialog,
  type BanEntry,
} from "~/features/admin";
import { withVerifiedMember, type MemberStatus } from "~/features/auth";
import { KeysetNav } from "~/shared/components/page-nav";
import { readPageCursor } from "~/shared/lib/keyset";
import { formatDateTime } from "~/shared/lib/time";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const cursor = readPageCursor(new URL(request.url).searchParams);
  const page = await withVerifiedMember(request, () => listBans(cursor));
  // 진행 중인지는 읽은 시점을 기준으로 가른다(렌더 중에 시계를 읽지 않는다).
  const now = Date.now();
  return {
    page: {
      ...page,
      items: page.items.map((ban) => ({
        ...ban,
        active: isBanActive(ban, now),
      })),
    },
  };
}

export const meta: Route.MetaFunction = () => [
  { title: "차단 내역 - 큼온 위키" },
];

/** 공개 차단 내역. 모든 회원이 본다. 관리자에게는 해제 버튼이 보인다. */
export default function BansRoute({ loaderData }: Route.ComponentProps) {
  const { page } = loaderData;
  const bans = page.items;
  const status = useOutletContext<MemberStatus>();
  const revalidator = useRevalidator();
  const [lifting, setLifting] = useState<BanEntry | null>(null);
  const [changing, setChanging] = useState<BanEntry | null>(null);

  return (
    <div>
      <h1 className="mb-2 border-b pb-3 text-2xl font-bold">차단 내역</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        차단된 회원은 모든 문서에서 편집이 제한됩니다. 가명은 차단 근거가 된
        문서의 가명입니다.
      </p>

      {bans.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">
          차단 내역이 없습니다.
        </p>
      ) : (
        <ul className="divide-y text-sm">
          {bans.map((ban) => (
            <li key={ban.id} className="flex flex-wrap items-center gap-2 py-3">
              <Badge variant={ban.active ? "destructive" : "outline"}>
                {ban.active ? "차단 중" : ban.liftedAt ? "해제됨" : "만료"}
              </Badge>
              <span className="font-mono text-xs">{ban.pseudonym}</span>
              <span className="text-muted-foreground">({ban.pageTitle})</span>
              <span className="text-muted-foreground">
                {formatDateTime(ban.startsAt)} ~{" "}
                {ban.endsAt ? formatDateTime(ban.endsAt) : "기한 없음"}
              </span>
              <span className="basis-full sm:basis-auto">
                사유: {ban.reason}
              </span>
              {status.isAdmin && ban.active ? (
                <span className="ml-auto flex gap-1">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => setChanging(ban)}
                  >
                    기간 변경
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => setLifting(ban)}
                  >
                    해제
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <KeysetNav path="/bans" page={page} />

      <ReasonDialog
        open={lifting !== null}
        onOpenChange={(open) => !open && setLifting(null)}
        title="차단 해제"
        description={`${lifting?.pseudonym ?? ""} (${lifting?.pageTitle ?? ""})의 차단을 해제합니다.`}
        confirmLabel="해제"
        onConfirm={(reason) =>
          lifting ? liftBan(lifting.id, reason) : Promise.resolve()
        }
        onDone={() => void revalidator.revalidate()}
      />

      <ChangeBanDialog
        ban={changing}
        onClose={() => setChanging(null)}
        onDone={() => void revalidator.revalidate()}
      />
    </div>
  );
}
