import type { RevisionSummary } from "../model/types";
import { cn } from "~/shared/lib/utils";

const count = (value: number) => value.toLocaleString("ko");

/**
 * 판에서 더한 글자와 뺀 글자(`+12 −3`). 보이는 글자가 그대로인 판(꾸밈, 표, 분류, 넘겨줄 곳만 바꿨거나
 * 이동한 판)은 숫자 대신 "서식 변경"을 보인다. 첫 판은 빈 문서라도 `+0`이다. 세는 방법은 DB의
 * `private.text_change`에 있다.
 */
export function TextChange({
  revision: { textAdded: added, textRemoved: removed, parentRevisionId },
  className,
}: {
  revision: Pick<
    RevisionSummary,
    "textAdded" | "textRemoved" | "parentRevisionId"
  >;
  className?: string;
}) {
  if (added === 0 && removed === 0 && parentRevisionId !== null) {
    return (
      <span
        className={cn("text-muted-foreground", className)}
        title="보이는 글자는 그대로이고 꾸밈, 표, 분류 같은 것만 바뀌었습니다."
      >
        서식 변경
      </span>
    );
  }
  const showAdded = added > 0 || removed === 0;
  const label = [
    showAdded ? `${count(added)}자 더함` : null,
    removed > 0 ? `${count(removed)}자 뺌` : null,
  ]
    .filter(Boolean)
    .join(", ");
  // 숫자는 눈으로 보는 표시다. 화면 읽기 프로그램은 단위가 있는 `label`을 읽는다.
  return (
    <span
      className={cn("inline-flex gap-1.5 tabular-nums", className)}
      title={label}
    >
      <span className="sr-only">{label}</span>
      {showAdded ? (
        <span
          aria-hidden
          className={
            added > 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-muted-foreground"
          }
        >
          +{count(added)}
        </span>
      ) : null}
      {removed > 0 ? (
        <span aria-hidden className="text-destructive">
          −{count(removed)}
        </span>
      ) : null}
    </span>
  );
}
