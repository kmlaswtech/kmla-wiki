import { FileText, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { WikiDoc } from "~/features/markup";
import {
  getPresetBody,
  PresetChooser,
  presetLabel,
  suggestPresets,
  type Preset,
} from "~/features/presets";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";

/**
 * 새 문서의 "템플릿으로 시작하기" 상자. 추천 템플릿은 단추로, 나머지는 고르기 대화상자로 고른다.
 *
 * 글을 쓰기 시작해도 사라지지 않는다. 치는 중에 상자가 사라지면 편집기가 위로 튀기 때문이다. 템플릿을
 * 적용하거나 닫으면 사라진다(부르는 쪽이 정한다). 이미 쓴 글이 있으면 덮기 전에 묻는다.
 */
export function PresetStart({
  pageTitle,
  presets,
  categoryKeys,
  dirty,
  onApply,
  onClose,
}: {
  pageTitle: string;
  presets: readonly Preset[];
  /** 추천에 쓸 분류 키. 앞에 둔 것이 먼저다(`suggestPresets`). */
  categoryKeys: readonly string[];
  /** 편집기 본문에 이미 쓴 내용이 있는가. */
  dirty: boolean;
  onApply: (doc: WikiDoc) => void;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [choosing, setChoosing] = useState(false);
  /** 덮을지 묻는 중인 템플릿 본문. */
  const [pending, setPending] = useState<WikiDoc | null>(null);
  // 템플릿을 받는 동안에도 글과 분류를 고칠 수 있다. 받은 뒤에는 그때의 값으로 판단하고 적용한다.
  const latest = useRef({ dirty, onApply });
  useEffect(() => {
    latest.current = { dirty, onApply };
  });

  const suggestions = useMemo(
    () => suggestPresets(pageTitle, presets, categoryKeys),
    [pageTitle, presets, categoryKeys],
  );

  async function load(presetTitle: string) {
    setChoosing(false);
    setLoading(true);
    try {
      const body = await getPresetBody(presetTitle);
      if (!body) toast.error("템플릿 문서를 찾지 못했습니다.");
      else if (latest.current.dirty) setPending(body);
      else latest.current.onApply(body);
    } catch {
      toast.error("템플릿을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section
      aria-label="템플릿으로 시작하기"
      className="space-y-2 rounded-md border border-dashed px-3 py-2.5 text-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-medium">
          <FileText className="size-4" aria-hidden />
          템플릿으로 시작하기
        </p>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label="템플릿 상자 닫기"
          onClick={onClose}
        >
          <X aria-hidden />
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((title) => (
          <Button
            key={title}
            type="button"
            size="sm"
            variant="secondary"
            disabled={loading}
            onClick={() => void load(title)}
          >
            {presetLabel(title)} 템플릿
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={loading}
          onClick={() => setChoosing(true)}
        >
          {suggestions.length > 0 ? "다른 템플릿 고르기…" : "템플릿 고르기…"}
        </Button>
      </div>
      <p className="text-muted-foreground">
        템플릿 없이 작성하려면 아래 편집기에 바로 작성하세요.
      </p>
      <PresetChooser
        open={choosing}
        onOpenChange={setChoosing}
        presets={presets}
        onPick={(title) => void load(title)}
      />
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>템플릿으로 바꿀까요?</DialogTitle>
            <DialogDescription>
              지금 작성한 본문이 지워지고 템플릿 내용으로 바뀝니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPending(null)}
            >
              취소
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (pending) latest.current.onApply(pending);
                setPending(null);
              }}
            >
              바꾸기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
