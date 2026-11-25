import { useState } from "react";

import { restoreRevokedAdmin } from "../data/mutations";
import type { RestorableRevocation } from "../model/log";
import { ReasonDialog } from "./reason-dialog";
import { formatDateTime } from "~/shared/lib/time";
import { Button } from "~/shared/ui/button";

/** 되돌릴 수 있는 관리자 해제와 되돌리기 대화상자. 번호는 해제의 공개 기록 번호다. */
export function RestorableRevocationList({
  revocations,
  onChanged,
}: {
  revocations: RestorableRevocation[];
  onChanged: () => void;
}) {
  const [restoring, setRestoring] = useState<RestorableRevocation | null>(null);

  return (
    <>
      <ul className="divide-y rounded-md border text-sm">
        {revocations.map((revocation) => (
          <li
            key={revocation.logId}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2"
          >
            <span className="text-muted-foreground tabular-nums">
              #{revocation.logId}
            </span>
            <span className="font-medium">{revocation.handle}</span>
            <span className="min-w-0 truncate text-muted-foreground">
              {revocation.reason}
            </span>
            <span className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {formatDateTime(revocation.restorableUntil)}까지
              </span>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setRestoring(revocation)}
              >
                되돌리기
              </Button>
            </span>
          </li>
        ))}
      </ul>

      <ReasonDialog
        open={restoring !== null}
        onOpenChange={(open) => !open && setRestoring(null)}
        title="관리자 해제 되돌리기"
        description={`‘${restoring?.handle ?? ""}’의 해제를 되돌려 같은 사람에게 관리자 권한을 다시 줍니다. 공개 기록에는 어느 해제를 되돌렸는지만 표시됩니다.`}
        confirmLabel="되돌리기"
        onConfirm={async (reason) => {
          if (restoring) await restoreRevokedAdmin(restoring.logId, reason);
        }}
        onDone={onChanged}
      />
    </>
  );
}
