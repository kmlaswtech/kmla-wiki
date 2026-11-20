import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "~/shared/ui/button";

const OPTIONS: { value: string; label: string; icon: LucideIcon }[] = [
  { value: "system", label: "기기 설정 따르기", icon: Monitor },
  { value: "light", label: "밝게", icon: Sun },
  { value: "dark", label: "어둡게", icon: Moon },
];

/**
 * 화면 테마 고르기. 고른 값은 `next-themes`가 이 브라우저에 저장한다(기기마다 따로다).
 * 편집기 툴바의 켜고 끄는 단추와 같은 모양이다(눌린 것은 `secondary`).
 */
export function ThemeSelect() {
  const { theme = "system", setTheme } = useTheme();

  return (
    <div role="group" aria-label="화면 테마" className="inline-flex gap-1">
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const selected = theme === value;
        return (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={selected ? "secondary" : "ghost"}
            aria-pressed={selected}
            onClick={() => setTheme(value)}
          >
            <Icon aria-hidden />
            {label}
          </Button>
        );
      })}
    </div>
  );
}
