import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "~/shared/lib/utils";

/** 이만큼 내려온 뒤에 단추를 보인다. 짧은 화면에는 필요 없다. */
const SHOW_AFTER_PX = 400;

/** 화면 오른쪽 아래의 맨 위로·맨 아래로 단추. 긴 문서를 오갈 때 쓴다. */
export function ScrollButtons({ className }: { className?: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const update = () => setVisible(window.scrollY > SHOW_AFTER_PX);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  if (!visible) return null;

  const button =
    "flex size-9 items-center justify-center rounded-full border bg-background/95 text-muted-foreground shadow-sm backdrop-blur hover:bg-muted hover:text-foreground";

  return (
    <div
      className={cn(
        "fixed right-4 bottom-4 z-20 flex flex-col gap-2 print:hidden",
        className,
      )}
    >
      <button
        type="button"
        className={button}
        aria-label="맨 위로"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      >
        <ArrowUp className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        className={button}
        aria-label="맨 아래로"
        onClick={() =>
          window.scrollTo({
            top: document.documentElement.scrollHeight,
            behavior: "smooth",
          })
        }
      >
        <ArrowDown className="size-4" aria-hidden />
      </button>
    </div>
  );
}
