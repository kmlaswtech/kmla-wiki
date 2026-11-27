import { useId, useState } from "react";
import { Link, useNavigate } from "react-router";

import { pageExists } from "../data/presets";
import { presetEditHref, presetLabel } from "../model/presets";
import { pageHref, parseTitle } from "~/features/markup";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { Input } from "~/shared/ui/input";
import { Label } from "~/shared/ui/label";

/**
 * 분류 문서의 "템플릿" 칸. 이 분류가 달린 템플릿(`위키:템플릿/…`)을 속한 문서와 따로 보이고, 템플릿으로 새
 * 문서를 만드는 단추를 둔다.
 */
export function CategoryPresets({
  presets,
  canCreate,
}: {
  presets: readonly string[];
  /** 문서를 만들 수 있는 사용자인가. 화면용이고 실제 판정은 서버가 한다. */
  canCreate: boolean;
}) {
  const [creating, setCreating] = useState<string | null>(null);

  return (
    <section className="mt-8">
      <h2 className="mb-2 border-b pb-1.5 text-xl font-bold">템플릿</h2>
      <ul className="space-y-1 text-sm">
        {presets.map((title) => (
          <li key={title} className="flex flex-wrap items-center gap-x-3">
            <Link to={pageHref(title)} className="text-primary hover:underline">
              {presetLabel(title)}
            </Link>
            {canCreate ? (
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => setCreating(title)}
              >
                이 템플릿으로 문서 만들기
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <CreateFromPresetDialog
        preset={creating}
        onClose={() => setCreating(null)}
      />
    </section>
  );
}

/** 새 문서 제목을 받아, 템플릿을 채운 편집 화면으로 간다. */
function CreateFromPresetDialog({
  preset,
  onClose,
}: {
  preset: string | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const inputId = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<{
    message: string;
    existing?: string;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  // 닫히는 동안에도 제목이 남게 마지막 템플릿을 기억한다(닫힐 때 `preset`이 먼저 `null`이 된다).
  const [shown, setShown] = useState(preset);
  if (preset !== null && preset !== shown) setShown(preset);

  const close = () => {
    setValue("");
    setError(null);
    onClose();
  };

  async function submit() {
    if (!preset) return;
    const title = parseTitle(value);
    if (!title) {
      setError({
        message: "쓸 수 없는 제목입니다([ ] { } | # < >는 쓸 수 없습니다).",
      });
      return;
    }
    setChecking(true);
    try {
      if (await pageExists(title)) {
        setError({ message: "이미 있는 문서입니다.", existing: title });
        return;
      }
    } catch {
      // 확인하지 못해도 편집 화면이 다시 확인한다(있는 문서면 템플릿 없이 연다).
    } finally {
      setChecking(false);
    }
    close();
    void navigate(presetEditHref(title, preset));
  }

  return (
    <Dialog open={preset !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {shown ? `"${presetLabel(shown)}" 템플릿으로 문서 만들기` : ""}
            </DialogTitle>
            <DialogDescription>
              만들 문서의 제목을 쓰세요. 템플릿 내용이 채워진 편집 화면이
              열립니다.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={inputId}>문서 제목</Label>
            <Input
              id={inputId}
              value={value}
              aria-invalid={error ? true : undefined}
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
              }}
            />
            {error ? (
              <p className="text-sm text-destructive">
                {error.message}
                {error.existing ? (
                  <>
                    {" "}
                    <Link
                      to={pageHref(error.existing)}
                      className="text-primary hover:underline"
                    >
                      문서 보기
                    </Link>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              취소
            </Button>
            <Button type="submit" disabled={value.trim() === "" || checking}>
              만들기
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
