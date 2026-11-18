import { Autocomplete } from "@base-ui/react/autocomplete";
import { FileText, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Form, useNavigate } from "react-router";

import { pageHref } from "~/features/markup";
import { suggestTitles } from "~/features/pages";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";

/** 입력이 멈추고 후보를 받으러 가기까지의 시간. */
const SUGGEST_DELAY_MS = 150;
const SUGGEST_LIMIT = 8;

type Suggestion =
  { kind: "page"; title: string } | { kind: "search"; query: string };

/**
 * 머리띠의 검색창.
 *
 * 치는 동안 제목 후보를 보여 주고, 후보를 고르면 그 문서로 바로 간다. 후보를 고르지 않고 Enter를
 * 치면 `go=1`을 붙여 검색으로 가고, 제목이 정확히 맞는 문서가 있으면 검색 화면이 그 문서로 넘긴다.
 * 결과 목록을 보고 싶을 때는 후보 맨 아래의 "전체 검색"을 고른다.
 */
export function SearchBox({ className }: { className?: string }) {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  /** 입력칸의 확정된 값. Base UI에 넘기는 데만 쓴다. */
  const [query, setQuery] = useState("");
  /**
   * 후보를 찾을 값. 한글을 조합하는 동안에는 Base UI가 `onValueChange`를 부르지 않아 `query`가
   * 멈춰 있으므로, 입력칸 값을 직접 받아 둔다. Base UI는 조합 중에 바깥 값이 바뀌지 않게 일부러
   * 막아 두었으므로(mui/base-ui#2942) 이 값은 `query`에 넣지 않는다. 후보 찾기와 제출은 이 값을
   * 쓴다. 그래야 조합 중에 Enter를 쳐도 화면에 보이는 검색어로 찾는다.
   */
  const [typed, setTyped] = useState("");
  const [titles, setTitles] = useState<string[]>([]);
  /** 늦게 도착한 앞선 응답이 새 결과를 덮지 않게 요청마다 번호를 매긴다. */
  const requestId = useRef(0);

  /** 후보 찾기와 제출에 같이 쓰는 검색어. */
  const trimmed = typed.trim();

  useEffect(() => {
    const id = ++requestId.current;
    // 빈 검색어에는 후보를 그리지 않는다(아래 `items`). 앞선 후보는 다음 응답이 덮는다. 입력칸을
    // 비우면 후보도 비운다(`changeTyped`). 남겨 두면 새로 친 글자에 맞지 않는 후보가 잠깐 보인다.
    if (trimmed === "") return;
    const timer = window.setTimeout(() => {
      suggestTitles(trimmed, "", SUGGEST_LIMIT)
        .then((next) => {
          if (id === requestId.current) setTitles(next);
        })
        // 후보를 못 받아도 검색은 된다.
        .catch(() => undefined);
    }, SUGGEST_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [trimmed]);

  // `/`를 누르면 검색창으로 간다. 글을 쓰는 중에는 가로채지 않는다.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey)
        return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest("input, textarea, select, [contenteditable=true]") ||
        target?.isContentEditable
      )
        return;
      event.preventDefault();
      input.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const items: Suggestion[] =
    trimmed === ""
      ? []
      : [
          ...titles.map((title) => ({ kind: "page" as const, title })),
          { kind: "search", query: trimmed },
        ];

  function changeTyped(next: string) {
    setTyped(next);
    // 이미 비어 있으면 그대로 둔다(새 배열을 넣으면 쓸데없이 다시 그린다).
    if (next.trim() === "") setTitles((prev) => (prev.length ? [] : prev));
  }

  function reset() {
    setQuery("");
    changeTyped("");
  }

  function go(to: string) {
    reset();
    input.current?.blur();
    void navigate(to);
  }

  return (
    <Form
      action="/search"
      role="search"
      className={cn("flex", className)}
      onSubmit={(event) => {
        if (trimmed === "") {
          event.preventDefault();
          return;
        }
        // 제출 뒤에는 검색창을 비운다. 검색어는 검색 화면 제목에 남는다.
        window.setTimeout(reset, 0);
      }}
    >
      <input type="hidden" name="q" value={trimmed} />
      <input type="hidden" name="go" value="1" />
      <Autocomplete.Root
        items={items}
        filter={null}
        value={query}
        onValueChange={(next, details) => {
          // 후보를 골라 입력칸이 바뀌는 것은 무시한다. 고르면 곧바로 다른 화면으로 간다.
          // 보통의 입력은 아래 `onChange`가 이미 받았지만, 입력 이벤트 없이 바뀌는 경우(지우기 등)가
          // 있어 여기서도 맞춘다. 값이 같으면 React가 다시 그리지 않는다.
          if (details.reason !== "item-press") {
            setQuery(next);
            changeTyped(next);
          }
        }}
        itemToStringValue={(item: Suggestion) =>
          item.kind === "page" ? item.title : item.query
        }
      >
        {/* 테두리는 입력칸과 그 안의 단추(지우기, 검색)를 함께 감싼 상자에 둔다. 높이는 머리띠의 다른
            단추와 맞춘다(손가락으로 누르는 화면에서는 한 단계 크다). */}
        <Autocomplete.InputGroup className="flex h-8 w-full min-w-0 items-center rounded-md border border-input pr-0.5 transition-[color,box-shadow] focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/50 dark:bg-muted coarse:h-9">
          <Autocomplete.Input
            ref={input}
            // 조합 중인 값도 후보 찾기에 쓴다(`typed` 설명).
            onChange={(event) => changeTyped(event.currentTarget.value)}
            type="search"
            aria-label="문서 검색"
            placeholder="문서 검색"
            autoComplete="off"
            // 브라우저가 붙이는 지우기(×) 단추는 브라우저마다 다르게 생겨 숨기고 아래 단추를 쓴다.
            className="h-full min-w-0 flex-1 bg-transparent pl-2.5 text-base outline-none placeholder:text-muted-foreground md:text-sm [&::-webkit-search-cancel-button]:appearance-none"
          />
          {/* Base UI의 `Clear`는 한글을 조합하는 동안 입력칸이 빈 줄로 알아 숨는다. `typed`로 직접 그린다. */}
          {typed !== "" ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className={INNER_BUTTON}
              aria-label="검색어 지우기"
              onClick={() => {
                reset();
                input.current?.focus();
              }}
            >
              <X />
            </Button>
          ) : null}
          <Button
            type="submit"
            size="icon-sm"
            variant="ghost"
            className={INNER_BUTTON}
            aria-label="검색"
          >
            <Search />
          </Button>
        </Autocomplete.InputGroup>
        <Autocomplete.Portal>
          <Autocomplete.Positioner
            className="z-50 outline-none"
            sideOffset={4}
            align="start"
          >
            {/* 폰에서는 입력칸이 머리띠 한 줄에 들어가 좁다. 후보 제목이 잘리지 않게 최소 폭을 둔다. */}
            <Autocomplete.Popup className="w-(--anchor-width) max-w-(--available-width) min-w-[min(20rem,var(--available-width))] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md">
              <Autocomplete.List className="max-h-[min(var(--available-height),22rem)] overflow-y-auto overscroll-contain p-1">
                {(item: Suggestion) =>
                  item.kind === "page" ? (
                    <Autocomplete.Item
                      key={`page:${item.title}`}
                      value={item}
                      onClick={() => go(pageHref(item.title))}
                      className={ITEM}
                    >
                      <FileText
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      <span className="truncate">{item.title}</span>
                    </Autocomplete.Item>
                  ) : (
                    <Autocomplete.Item
                      key="search"
                      value={item}
                      onClick={() =>
                        go(`/search?q=${encodeURIComponent(item.query)}`)
                      }
                      className={cn(ITEM, "text-muted-foreground")}
                    >
                      <Search className="size-4 shrink-0" aria-hidden />
                      <span className="truncate">
                        &lsquo;{item.query}&rsquo; 전체 검색
                      </span>
                    </Autocomplete.Item>
                  )
                }
              </Autocomplete.List>
            </Autocomplete.Popup>
          </Autocomplete.Positioner>
        </Autocomplete.Portal>
      </Autocomplete.Root>
    </Form>
  );
}

/** 입력칸 상자 안의 단추. 상자 안이라 hover 배경 없이 글자색만 바꾼다. */
const INNER_BUTTON =
  "size-7 text-muted-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent coarse:size-8";

const ITEM =
  "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground";
