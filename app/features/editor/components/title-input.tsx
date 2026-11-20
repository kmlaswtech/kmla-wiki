import { Popover } from "@base-ui/react/popover";
import { useEffect, useId, useRef, useState, type ClipboardEvent } from "react";

import { sectionCandidates, sectionExists } from "../model/section-link";
import { wikiAddressTarget } from "../model/wiki-address";
import {
  listHeadings,
  suggestTitles,
  type HeadingTarget,
  type TitleSuggestion,
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
   * 칸 아래에 알린다.
   */
  sections?: boolean;
  /**
   * Tab으로 후보를 칸에 채울지. 기본은 `sections`를 따른다. 새 문서 제목 같은 칸에서는 다음 칸으로
   * 가려고 누른 Tab이 친 제목을 바꾸면 안 되므로 끈다. 있는 문서를 고르는 칸에서만 켠다.
   */
  tabCompletes?: boolean;
  /**
   * 위키 문서 주소(`https://wiki.kmla.online/w/귀가#신청`)를 붙여넣으면 문서 이름으로 바꿀지.
   * `sections`가 꺼져 있으면 `#` 뒤 문단은 버린다.
   */
  wikiAddresses?: boolean;
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
  /** 고르면 칸에 들어갈 글 전체. 넘겨주기 문서이면 그 대상이라 `label`과 다르다. */
  value: string;
}

/**
 * 제목 자동완성. 치는 동안 비슷한 문서 제목을 아래에 보여 준다.
 *
 * ↑↓로 후보를 옮기고 Enter로 고른다. `tabCompletes` 칸에서는 Tab이 후보를 칸에 채우기만 하고 초점은
 * 그대로 둔다. 그래서 링크 칸에서는 이어서 `#문단`을 칠 수 있다.
 */
export function TitleInput({
  id,
  value,
  onChange,
  onCommit,
  submitOnEnter = true,
  prefix = "",
  sections = false,
  tabCompletes = sections,
  wikiAddresses = false,
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
    titles: TitleSuggestion[];
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
          // 대상도 같은 이름공간 안에 있다(밖이면 DB가 `null`을 준다).
          titles: titles.map(({ title, redirectTarget }) => ({
            title: withoutPrefix(title, prefix),
            redirectTarget:
              redirectTarget && withoutPrefix(redirectTarget, prefix),
          })),
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
    // 넘겨주기 문서는 줄임말로 찾을 수 있게 후보에 보이되, 고르면 대상이 들어간다. 링크와 넘겨주기가
    // 넘겨주기 문서를 거치지 않게 한다.
    options = suggestions.titles.map(({ title, redirectTarget }) => ({
      label: title,
      value: redirectTarget ?? title,
    }));
  }
  // 칸에 든 글이 이미 이 후보인가. 넘겨주기 후보는 이름(`label`)으로 쳐도 같다고 본다.
  const typed = value.trim();
  const typedIs = (option: Option) =>
    option.value === typed || option.label === typed;
  // 이미 칸에 든 것과 같은 후보 하나만 남았으면 목록을 접는다.
  const visible =
    !open || (options.length === 1 && typedIs(options[0]!)) ? [] : options;

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

  /**
   * 붙여넣은 위키 문서 주소를 문서 이름으로 바꿔 넣는다. 위키 주소가 아니면 평소처럼 붙여넣는다. 손으로
   * 주소를 치는 동안에는 바꾸지 않는다(한글 조합 중에 칸의 글이 바뀌면 입력이 끊긴다).
   */
  const pasteWikiAddress = (event: ClipboardEvent<HTMLInputElement>) => {
    if (!wikiAddresses) return;
    const address = wikiAddressTarget(
      event.clipboardData.getData("text"),
      window.location.origin,
    );
    if (address === null) return;
    event.preventDefault();
    const text =
      sections && address.section
        ? `${address.title}#${address.section}`
        : address.title;
    const input = event.currentTarget;
    const start = input.selectionStart ?? value.length;
    const end = input.selectionEnd ?? start;
    onChange(value.slice(0, start) + text + value.slice(end));
    setOpen(true);
    setActive(-1);
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
        onPaste={pasteWikiAddress}
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
            tabCompletes &&
            fresh &&
            visible.length > 0 &&
            // 고르지 않았는데 친 글이 이미 후보와 같으면 채울 것이 없다. 평소처럼 다음 칸으로 간다.
            (active >= 0 || !visible.some(typedIs))
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
                  key={option.label}
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
                  {!sectionMode && option.value !== option.label ? (
                    <span className="text-muted-foreground">
                      {" "}
                      → {option.value}
                    </span>
                  ) : null}
                </div>
              ))}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {missingSection ? (
        <p id={warningId} className="mt-1.5 text-sm text-destructive">
          이 문단을 찾을 수 없습니다. 그대로 삽입하면 문서 맨 위로 연결됩니다.
        </p>
      ) : null}
    </div>
  );
}

/** 이름공간 접두어(`틀:`)를 뗀 이름. 후보는 접두어 없이 보여 주고 칸에 넣는다. */
function withoutPrefix(title: string, prefix: string): string {
  return prefix && title.startsWith(prefix)
    ? title.slice(prefix.length)
    : title;
}

/** 제목 후보를 찾을 만한 글인가. 비었거나 바깥 주소를 치는 중이면 찾지 않는다. */
function isSearchable(query: string): boolean {
  return query !== "" && !/^(https?:|mailto:|www\.)/i.test(query);
}
