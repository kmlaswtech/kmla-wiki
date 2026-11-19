import { Popover } from "@base-ui/react/popover";
import { useEffect, useId, useRef, useState } from "react";

import { sectionCandidates, sectionExists } from "../model/section-link";
import {
  listHeadings,
  suggestTitles,
  type HeadingTarget,
} from "~/features/pages";
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
  /**
   * `문서#문단`을 받는 링크 칸인가. 켜면 `#` 뒤에서 그 문서의 문단 제목을 후보로 보이고, 없는 문단이면
   * 칸 아래에 알린다. Tab으로 후보를 채우는 것도 이 칸에서만 한다. 새 문서 제목 같은 칸에서는 다음 칸으로
   * 가려고 누른 Tab이 친 제목을 바꾸면 안 되기 때문이다.
   */
  sections?: boolean;
  placeholder?: string;
  /** 대화상자를 열자마자 칠 수 있게 처음부터 초점을 둔다. */
  focusOnMount?: boolean;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  /** 입력 칸을 떠날 때. 후보를 누르는 것은 떠나는 것으로 치지 않는다. */
  onBlur?: () => void;
  "aria-describedby"?: string;
}

interface Option {
  label: string;
  /** 고르면 칸에 들어갈 글 전체. */
  value: string;
}

/**
 * 제목 자동완성. 치는 동안 비슷한 문서 제목을 아래에 보여 준다.
 *
 * ↑↓로 후보를 옮기고 Enter로 고른다. 링크 칸(`sections`)에서는 Tab이 후보를 칸에 채우기만 하고 초점은
 * 그대로 둔다. 그래서 이어서 `#문단`을 칠 수 있다.
 */
export function TitleInput({
  id,
  value,
  onChange,
  onCommit,
  submitOnEnter = true,
  prefix = "",
  sections = false,
  placeholder,
  focusOnMount,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  onBlur,
  "aria-describedby": ariaDescribedBy,
}: TitleInputProps) {
  const listId = useId();
  const anchorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const warningId = useId();
  // 어느 검색어의 후보인지도 둔다. 치는 동안에는 앞 검색어의 후보가 잠시 보인다.
  const [suggestions, setSuggestions] = useState<{
    query: string;
    titles: string[];
  }>({ query: "", titles: [] });
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);

  // 주소를 치는 중이면 제목 후보를 찾지 않는다. `#` 뒤는 문단이다.
  const [titlePart = "", ...sectionParts] = value.split("#");
  const query = titlePart.trim();
  const searchable = isSearchable(query);
  const sectionMode = sections && sectionParts.length > 0 && searchable;
  const sectionQuery = sectionParts.join("#").trim();
  // `#` 뒤를 치는 동안에는 제목 후보를 찾지 않는다.
  const settledQuery = useDebouncedValue(sectionMode ? "" : query, 150);
  const headingsTitle = useDebouncedValue(sectionMode ? query : "", 150);

  useEffect(() => {
    if (!isSearchable(settledQuery)) return;
    let cancelled = false;
    suggestTitles(settledQuery, prefix)
      .then((titles) => {
        if (cancelled) return;
        setSuggestions({
          query: settledQuery,
          titles: titles.map((title) =>
            prefix && title.startsWith(prefix)
              ? title.slice(prefix.length)
              : title,
          ),
        });
        setActive(-1);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [settledQuery, prefix]);

  // 문서별로 읽은 문단 후보. `#`을 지웠다 다시 치거나 앞 문서로 돌아와도 다시 읽지 않는다.
  const [headingsByTitle, setHeadingsByTitle] = useState<
    ReadonlyMap<string, HeadingTarget[] | null>
  >(() => new Map());

  useEffect(() => {
    if (!isSearchable(headingsTitle) || headingsByTitle.has(headingsTitle)) {
      return;
    }
    let cancelled = false;
    listHeadings(headingsTitle)
      .then((list) => {
        if (cancelled) return;
        setHeadingsByTitle((map) => new Map(map).set(headingsTitle, list));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [headingsTitle, headingsByTitle]);

  // 다른 문서 제목을 치는 동안에는 옛 문단을 쓰지 않는다.
  const currentHeadings = sectionMode
    ? (headingsByTitle.get(query) ?? null)
    : null;

  let options: Option[] = [];
  // 보이는 후보가 지금 친 글에 맞춘 것인가. 아니면 Tab으로 채우지 않는다.
  let fresh = false;
  if (sectionMode) {
    fresh = true;
    options = currentHeadings
      ? sectionCandidates(currentHeadings, sectionQuery).map((candidate) => ({
          label: candidate.label,
          value: `${query}#${candidate.value}`,
        }))
      : [];
  } else if (searchable) {
    fresh = suggestions.query === query;
    options = suggestions.titles.map((title) => ({
      label: title,
      value: title,
    }));
  }
  // 이미 칸에 든 것과 같은 후보 하나만 남았으면 목록을 접는다.
  const visible =
    !open || (options.length === 1 && options[0]!.value === value.trim())
      ? []
      : options;

  // 치는 중에는 맞는 후보가 보이므로 알리지 않는다. 맞는 후보가 없을 때만 알린다.
  const missingSection =
    currentHeadings !== null &&
    sectionQuery !== "" &&
    visible.length === 0 &&
    !sectionExists(currentHeadings, sectionQuery);

  // ↑↓로 고른 후보가 목록 밖에 있으면 보이게 목록을 스크롤한다.
  useEffect(() => {
    if (active < 0) return;
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (picked: string) => {
    onChange(picked);
    setOpen(false);
    onCommit?.(picked);
  };

  const describedBy =
    [ariaDescribedBy, missingSection ? warningId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div ref={anchorRef} className="relative">
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- 대화상자를 열자마자 칠 수 있게 한다.
        autoFocus={focusOnMount}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        aria-describedby={describedBy}
        role="combobox"
        aria-expanded={visible.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 150);
          onBlur?.();
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "ArrowDown" && visible.length > 0) {
            event.preventDefault();
            setActive((index) => (index + 1) % visible.length);
          } else if (event.key === "ArrowUp" && visible.length > 0) {
            event.preventDefault();
            setActive((index) => (index <= 0 ? visible.length - 1 : index - 1));
          } else if (
            event.key === "Tab" &&
            !event.shiftKey &&
            sections &&
            fresh &&
            visible.length > 0 &&
            // 고르지 않았는데 친 글이 이미 후보와 같으면 채울 것이 없다. 평소처럼 다음 칸으로 간다.
            (active >= 0 ||
              !visible.some((option) => option.value === value.trim()))
          ) {
            // 고른 후보(없으면 첫 후보)를 채우고 칸에 머문다.
            event.preventDefault();
            onChange((visible[active] ?? visible[0]!).value);
            setOpen(false);
            setActive(-1);
          } else if (event.key === "Escape" && visible.length > 0) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          } else if (event.key === "Enter") {
            // 후보를 골랐거나 따로 할 일이 있을 때만 가로챈다. 아니면 둘러싼 폼이 제출된다.
            const picked = visible[active];
            setOpen(false);
            if (picked === undefined && !onCommit && submitOnEnter) return;
            event.preventDefault();
            event.stopPropagation();
            if (picked !== undefined) choose(picked.value);
            else onCommit?.(value);
          }
        }}
      />
      {/* 대화상자 본문은 스크롤된다. 그 안에 두면 목록이 잘리므로 바깥(portal)에 띄운다. */}
      <Popover.Root
        open={visible.length > 0}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
      >
        <Popover.Portal>
          <Popover.Positioner
            anchor={anchorRef}
            side="bottom"
            align="start"
            sideOffset={4}
            collisionPadding={8}
            className="isolate z-50"
          >
            <Popover.Popup
              ref={listRef}
              initialFocus={false}
              finalFocus={false}
              id={listId}
              role="listbox"
              className="max-h-[min(14rem,var(--available-height))] w-(--anchor-width) overflow-y-auto rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none"
            >
              {visible.map((option, index) => (
                <div
                  key={option.value}
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
                    choose(option.value);
                  }}
                >
                  {sectionMode ? (
                    <span className="text-muted-foreground">#</span>
                  ) : null}
                  {option.label}
                </div>
              ))}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {missingSection ? (
        <p id={warningId} className="mt-1.5 text-sm text-destructive">
          {query} 문서에 이 문단이 없습니다. 이대로 넣으면 링크는 문서 맨 위로
          갑니다.
        </p>
      ) : null}
    </div>
  );
}

/** 제목 후보를 찾을 만한 글인가. 비었거나 바깥 주소를 치는 중이면 찾지 않는다. */
function isSearchable(query: string): boolean {
  return query !== "" && !/^(https?:|mailto:|www\.)/i.test(query);
}
