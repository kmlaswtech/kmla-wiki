import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { cn } from "~/shared/lib/utils";

const OPTIONS: { value: string; label: string; icon: LucideIcon }[] = [
  { value: "system", label: "기기 설정", icon: Monitor },
  { value: "light", label: "라이트", icon: Sun },
  { value: "dark", label: "다크", icon: Moon },
];

/**
 * 화면 테마 고르기. 고른 값은 `next-themes`가 이 브라우저에 저장한다(기기마다 따로다).
 */
export function ThemeSelect() {
  const { theme = "system", setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="화면 테마"
      className="inline-flex rounded-md border p-0.5"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const selected = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setTheme(value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-sm text-muted-foreground hover:text-foreground coarse:px-3 coarse:py-2",
              selected && "bg-muted font-medium text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}
