import { reportCategoryLabel, type ReportNote } from "../model/report";
import { formatDateTime } from "~/shared/lib/time";

/** 한 대상에 걸린 신고들(관리자 목록). 종류 · 덧붙임 · 시각. 신고자는 보이지 않는다. */
export function ReportNoteList({ notes }: { notes: readonly ReportNote[] }) {
  return (
    <ul className="mt-1 space-y-0.5">
      {notes.map((entry, index) => (
        <li key={index} className="text-muted-foreground">
          <span className="font-medium text-foreground">
            {reportCategoryLabel(entry.category)}
          </span>
          {entry.note ? ` · ${entry.note}` : null}
          <span className="text-xs"> · {formatDateTime(entry.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}
