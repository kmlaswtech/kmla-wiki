import { Autocomplete } from "@base-ui/react/autocomplete";
import { FileText, Search } from "lucide-react";
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
  const [query, setQuery] = useState("");
  const [titles, setTitles] = useState<string[]>([]);
  /** 늦게 도착한 앞선 응답이 새 결과를 덮지 않게 요청마다 번호를 매긴다. */
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    const trimmed = query.trim();
    // 빈 검색어에는 후보를 그리지 않는다(아래 `items`). 앞선 후보는 다음 응답이 덮는다.
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
  }, [query]);

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

  const trimmed = query.trim();
  const items: Suggestion[] =
    trimmed === ""
      ? []
      : [
          ...titles.map((title) => ({ kind: "page" as const, title })),
          { kind: "search", query: trimmed },
        ];

  function go(to: string) {
    setQuery("");
    setTitles([]);
    input.current?.blur();
    void navigate(to);
  }

  return (
    <Form
      action="/search"
      role="search"
      className={cn("flex gap-1", className)}
      onSubmit={(event) => {
        if (trimmed === "") {
          event.preventDefault();
          return;
        }
        // 제출 뒤에는 검색창을 비운다. 검색어는 검색 화면 제목에 남는다.
        window.setTimeout(() => setQuery(""), 0);
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
          if (details.reason !== "item-press") setQuery(next);
        }}
        itemToStringValue={(item: Suggestion) =>
          item.kind === "page" ? item.title : item.query
        }
      >
        <Autocomplete.Input
          ref={input}
          type="search"
          aria-label="문서 검색"
          placeholder="문서 검색"
          autoComplete="off"
          className="h-8 w-full min-w-0 flex-1 rounded-md border border-input bg-transparent px-2.5 py-1 text-base transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 md:text-sm dark:bg-muted"
        />
        <Autocomplete.Portal>
          <Autocomplete.Positioner
            className="z-50 outline-none"
            sideOffset={4}
            align="start"
          >
            <Autocomplete.Popup className="w-(--anchor-width) max-w-(--available-width) overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md">
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
      <Button type="submit" size="icon-sm" variant="outline" aria-label="검색">
        <Search />
      </Button>
    </Form>
  );
}

const ITEM =
  "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground";
