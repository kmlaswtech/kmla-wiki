import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { filterPresets, presetLabel, type Preset } from "../model/presets";
import { pageHref } from "~/features/markup";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { Input } from "~/shared/ui/input";

/** 모든 템플릿에서 하나를 고르는 대화상자. 이름으로 찾는다. */
export function PresetChooser({
  open,
  onOpenChange,
  presets,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presets: readonly Preset[];
  onPick: (presetTitle: string) => void;
}) {
  const [query, setQuery] = useState("");
  const shown = filterPresets(presets, query);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>템플릿 고르기</DialogTitle>
          <DialogDescription>
            고른 템플릿의 내용으로 편집기를 채웁니다.
          </DialogDescription>
        </DialogHeader>
        <Input
          type="search"
          value={query}
          placeholder="템플릿 이름으로 찾기"
          aria-label="템플릿 찾기"
          onChange={(event) => setQuery(event.target.value)}
        />
        {shown.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            맞는 템플릿이 없습니다.
          </p>
        ) : (
          <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
            {shown.map((preset) => (
              <li key={preset.title} className="flex items-center">
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm hover:bg-muted coarse:py-3"
                  onClick={() => {
                    setQuery("");
                    onPick(preset.title);
                  }}
                >
                  {presetLabel(preset.title)}
                </button>
                {/* 새 탭으로 연다. 쓰던 편집 내용은 그대로 둔다. */}
                <Link
                  to={pageHref(preset.title)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`${presetLabel(preset.title)} 템플릿 보기`}
                  className="shrink-0 p-2 text-muted-foreground hover:text-foreground coarse:p-3"
                >
                  <ExternalLink className="size-4" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
