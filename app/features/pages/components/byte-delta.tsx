import { formatByteDelta } from "../model/errors";
import { cn } from "~/shared/lib/utils";

/** 판의 바이트 변화량. 늘면 초록, 줄면 빨강, 그대로면 흐리게. */
export function ByteDelta({
  delta,
  className,
}: {
  delta: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "tabular-nums",
        delta > 0 && "text-emerald-600 dark:text-emerald-400",
        delta < 0 && "text-destructive",
        delta === 0 && "text-muted-foreground",
        className,
      )}
    >
      {formatByteDelta(delta)}
    </span>
  );
}
