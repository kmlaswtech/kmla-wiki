import { ChevronDown } from "lucide-react";
import {
  createContext,
  use,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "~/shared/lib/utils";

interface Fold {
  open: boolean;
  setOpen: (open: boolean) => void;
  bodyId: string;
}

/** 지금 그리는 제목이 속한 문단의 접기 상태. 접기를 쓰지 않는 화면(미리보기)에서는 `null`. */
const FoldContext = createContext<Fold | null>(null);

/**
 * 제목 하나와 그 아래 내용(`rehypeSections`가 묶은 것). 제목을 누르면 접고 편다.
 *
 * 접힌 내용은 `hidden="until-found"`로 숨긴다. 브라우저의 찾기(Ctrl+F)가 그 안의 글자를 찾으면
 * 저절로 펼쳐진다.
 */
export function FoldableSection({
  children,
  ...props
}: {
  children?: ReactNode;
  [attribute: string]: unknown;
}) {
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  return (
    <FoldContext value={{ open, setOpen, bodyId }}>
      <section {...props} data-collapsed={open ? undefined : ""}>
        {children}
      </section>
    </FoldContext>
  );
}

export function SectionBody({
  children,
  ...props
}: {
  children?: ReactNode;
  [attribute: string]: unknown;
}) {
  const fold = use(FoldContext);
  const ref = useRef<HTMLDivElement>(null);
  const open = fold?.open ?? true;
  const setOpen = fold?.setOpen;

  // React는 `hidden`을 참/거짓으로만 다룬다. "until-found"는 DOM에 직접 쓴다.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (open) element.removeAttribute("hidden");
    else element.setAttribute("hidden", "until-found");
  }, [open]);

  useEffect(() => {
    const element = ref.current;
    if (!element || !setOpen) return;

    // 찾기(Ctrl+F)가 접힌 내용 안의 글자를 찾았다.
    const onBeforeMatch = () => setOpen(true);

    // 목차나 `#주소`로 접힌 문단 안의 제목을 가리켰다. 펼친 뒤 그 자리로 간다.
    const revealHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const target = window.document.getElementById(id);
      if (!target || !element.contains(target)) return;
      if (!element.hasAttribute("hidden")) return;
      setOpen(true);
      window.requestAnimationFrame(() => target.scrollIntoView());
    };

    element.addEventListener("beforematch", onBeforeMatch);
    window.addEventListener("hashchange", revealHash);
    revealHash();
    return () => {
      element.removeEventListener("beforematch", onBeforeMatch);
      window.removeEventListener("hashchange", revealHash);
    };
  }, [setOpen]);

  return (
    <div {...props} ref={ref} id={fold?.bodyId}>
      {children}
    </div>
  );
}

/** 제목 앞의 접기 단추. 접기를 쓰지 않는 화면에서는 그리지 않는다. */
export function FoldToggle({ label }: { label: string }) {
  const fold = use(FoldContext);
  if (!fold) return null;
  return (
    <button
      type="button"
      aria-expanded={fold.open}
      aria-controls={fold.bodyId}
      aria-label={`${label} 문단 ${fold.open ? "접기" : "펼치기"}`}
      onClick={() => fold.setOpen(!fold.open)}
      className="mr-1 -ml-1 inline-flex size-6 shrink-0 items-center justify-center rounded align-middle text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <ChevronDown
        className={cn(
          "size-4 transition-transform",
          !fold.open && "-rotate-90",
        )}
        aria-hidden
      />
    </button>
  );
}

/** 제목 글자를 눌러도 접고 펴게 한다(나무위키와 같다). 제목 안의 링크·단추는 그대로 동작한다. */
export function useFoldOnHeadingClick() {
  const fold = use(FoldContext);
  if (!fold) return undefined;
  return (event: React.MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("a, button")) return;
    // 글자를 드래그해 고르는 중이면 접지 않는다.
    if (window.getSelection()?.toString()) return;
    fold.setOpen(!fold.open);
  };
}
