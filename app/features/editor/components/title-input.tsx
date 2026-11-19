import { useEffect, useId, useState } from "react";

import { suggestTitles } from "~/features/pages";
import { useDebouncedValue } from "~/shared/hooks/use-debounced-value";
import { cn } from "~/shared/lib/utils";
import { Input } from "~/shared/ui/input";

interface TitleInputProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** 후보를 고르거나 Enter를 쳤을 때. */
  onCommit?: (value: string) => void;
  /**
   * 후보를 고르지 않고 Enter를 쳤는데 `onCommit`도 없을 때 둘러싼 폼을 제출할지. 기본은 제출한다
   * (대화상자의 "넣기"). 문서 편집 폼 안의 칸처럼 Enter로 저장되면 안 되는 곳은 끈다.
   */
  submitOnEnter?: boolean;
  /** 이 이름공간 안에서만 찾는다(`틀:`, `분류:`). 후보는 접두사를 뗀 이름으로 보여 준다. */
  prefix?: string;
  placeholder?: string;
  /** 대화상자를 열자마자 칠 수 있게 처음부터 초점을 둔다. */
  focusOnMount?: boolean;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  /** 입력 칸을 떠날 때. 후보를 누르는 것은 떠나는 것으로 치지 않는다. */
  onBlur?: () => void;
  "aria-describedby"?: string;
}

/** 제목 자동완성. 치는 동안 비슷한 문서 제목을 아래에 보여 준다. */
export function TitleInput({
  id,
  value,
  onChange,
  onCommit,
  submitOnEnter = true,
  prefix = "",
  placeholder,
  focusOnMount,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  onBlur,
  "aria-describedby": ariaDescribedBy,
}: TitleInputProps) {
  const listId = useId();
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);

  // 주소나 `#문단`을 치는 중이면 제목 후보를 찾지 않는다.
  const query = value.split("#")[0]!.trim();
  const searchable = isSearchable(query);
  const settledQuery = useDebouncedValue(query, 150);

  useEffect(() => {
    if (!isSearchable(settledQuery)) return;
    let cancelled = false;
    suggestTitles(settledQuery, prefix)
      .then((titles) => {
        if (cancelled) return;
        setSuggestions(
          titles.map((title) =>
            prefix && title.startsWith(prefix)
              ? title.slice(prefix.length)
              : title,
          ),
        );
        setActive(-1);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [settledQuery, prefix]);

  const shown = open && searchable ? suggestions : [];

  const choose = (title: string) => {
    onChange(title);
    setOpen(false);
    onCommit?.(title);
  };

  return (
    <div className="relative">
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- 대화상자를 열자마자 칠 수 있게 한다.
        autoFocus={focusOnMount}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        role="combobox"
        aria-expanded={shown.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 150);
          onBlur?.();
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "ArrowDown" && shown.length > 0) {
            event.preventDefault();
            setActive((index) => (index + 1) % shown.length);
          } else if (event.key === "ArrowUp" && shown.length > 0) {
            event.preventDefault();
            setActive((index) => (index <= 0 ? shown.length - 1 : index - 1));
          } else if (event.key === "Escape" && shown.length > 0) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          } else if (event.key === "Enter") {
            // 후보를 골랐거나 따로 할 일이 있을 때만 가로챈다. 아니면 둘러싼 폼이 제출된다.
            const picked = shown[active];
            setOpen(false);
            if (picked === undefined && !onCommit && submitOnEnter) return;
            event.preventDefault();
            event.stopPropagation();
            if (picked !== undefined) choose(picked);
            else onCommit?.(value);
          }
        }}
      />
      {shown.length > 0 ? (
        <div
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-md border bg-popover p-1 text-sm shadow-md"
        >
          {shown.map((title, index) => (
            <div
              key={title}
              role="option"
              tabIndex={-1}
              aria-selected={index === active}
              className={cn(
                "cursor-pointer rounded px-2 py-1",
                index === active
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-muted",
              )}
              onMouseDown={(event) => {
                // 입력 칸의 blur보다 먼저 고른다.
                event.preventDefault();
                choose(title);
              }}
            >
              {title}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 제목 후보를 찾을 만한 글인가. 비었거나 바깥 주소를 치는 중이면 찾지 않는다. */
function isSearchable(query: string): boolean {
  return query !== "" && !/^(https?:|mailto:|www\.)/i.test(query);
}
