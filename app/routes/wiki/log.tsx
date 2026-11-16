import type { Route } from "./+types/log";
import {
  describeAdminLog,
  getAdminCount,
  listAdminLog,
} from "~/features/admin";
import { withVerifiedMember } from "~/features/auth";
import { RelativeTime } from "~/shared/components/relative-time";

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const [entries, adminCount] = await withVerifiedMember(request, () =>
    Promise.all([listAdminLog(), getAdminCount()]),
  );
  return { entries, adminCount };
}

export const meta: Route.MetaFunction = () => [
  { title: "관리 기록 - 큼온 위키" },
];

/**
 * 공개 관리 기록. 관리자가 한 모든 조치가 사유와 함께 남는다.
 *
 * 누가 했는지는 "관리자"로만 보인다. 관리자가 문서별 가명을 넘어 한 사람의 편집을 모아 본 것도
 * 여기에 남는다.
 */
export default function LogRoute({ loaderData }: Route.ComponentProps) {
  const { entries, adminCount } = loaderData;

  return (
    <div>
      <h1 className="mb-2 border-b pb-3 text-2xl font-bold">관리 기록</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        관리자는 {adminCount}명입니다. 관리자가 한 조치는 모두 사유와 함께
        여기에 남습니다.
      </p>

      {entries.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">
          아직 기록이 없습니다.
        </p>
      ) : (
        <ul className="divide-y text-sm">
          {entries.map((entry) => (
            <li key={entry.id} className="py-2.5">
              <p>
                <span className="mr-2 text-muted-foreground">
                  <RelativeTime value={entry.createdAt} />
                </span>
                {describeAdminLog(entry)}
              </p>
              <p className="text-muted-foreground">사유: {entry.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
