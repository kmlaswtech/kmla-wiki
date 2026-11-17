import { CornerDownRight, Tag, X } from "lucide-react";
import { useState } from "react";

import type { DocMeta } from "../model/doc-io";
import { TitleInput } from "./title-input";
import { baseName, categoryTitle, parseTitle } from "~/features/markup";
import { Button } from "~/shared/ui/button";

/**
 * 본문 흐름 밖의 문서 정보: 분류와 넘겨주기. 편집기 아래에 따로 둔다.
 *
 * 넘겨주기 칸은 넘겨주기 문서일 때나 툴바에서 고를 때만 보인다(대부분의 문서에는 필요 없다).
 */
export function DocMetaFields({
  meta,
  onChange,
  showRedirect,
  onHideRedirect,
}: {
  meta: DocMeta;
  onChange: (meta: DocMeta) => void;
  showRedirect: boolean;
  onHideRedirect: () => void;
}) {
  const [category, setCategory] = useState("");
  const redirectInvalid =
    meta.redirect.trim() !== "" && parseTitle(meta.redirect) === null;

  const categoryInvalid = category.trim() !== "" && categoryTitle(category) === null;

  /** 쓴 분류를 붙인다. 쓸 수 없는 이름이면 글자를 남겨 고치게 한다. */
  const addCategory = (name: string) => {
    if (name.trim() === "") return;
    const title = categoryTitle(name);
    if (!title) return;
    setCategory("");
    if (meta.categories.includes(title)) return;
    onChange({ ...meta, categories: [...meta.categories, title] });
  };

  return (
    <div className="space-y-3 rounded-md border px-3 py-2.5">
      {showRedirect ? (
        <div className="grid gap-1.5">
          <label
            htmlFor="doc-redirect"
            className="flex items-center gap-1.5 text-sm font-medium"
          >
            <CornerDownRight className="size-4" aria-hidden />
            넘겨주기
          </label>
          <p className="text-xs text-muted-foreground">
            이 문서를 열면 아래 문서로 바로 넘어갑니다. 다른 이름으로도 찾아오게 할 때 씁니다.
          </p>
          <div className="flex gap-2">
            <div className="flex-1">
              <TitleInput
                id="doc-redirect"
                value={meta.redirect}
                onChange={(redirect) => onChange({ ...meta, redirect })}
                // 여기서 Enter를 쳐도 문서가 저장되지 않게 한다.
                submitOnEnter={false}
                placeholder="넘겨줄 문서 이름"
                aria-invalid={redirectInvalid || undefined}
                aria-describedby={redirectInvalid ? "doc-redirect-error" : undefined}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange({ ...meta, redirect: "" });
                onHideRedirect();
              }}
            >
              넘겨주기 없애기
            </Button>
          </div>
          {redirectInvalid ? (
            <p id="doc-redirect-error" className="text-sm text-destructive">
              쓸 수 없는 문서 이름입니다({"[ ] { } | # < >"}는 제목에 쓸 수 없습니다). 이대로
              저장하면 넘겨주기가 빠집니다.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-1.5">
        <label
          htmlFor="doc-category"
          className="flex items-center gap-1.5 text-sm font-medium"
        >
          <Tag className="size-4" aria-hidden />
          분류
        </label>
        {meta.categories.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="이 문서의 분류">
            {meta.categories.map((title) => (
              <li
                key={title}
                className="inline-flex items-center gap-1 rounded-full border bg-muted/50 py-0.5 pr-1 pl-2.5 text-sm"
              >
                {baseName(title)}
                <button
                  type="button"
                  aria-label={`${baseName(title)} 분류 빼기`}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() =>
                    onChange({
                      ...meta,
                      categories: meta.categories.filter((item) => item !== title),
                    })
                  }
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <TitleInput
          id="doc-category"
          value={category}
          onChange={setCategory}
          onCommit={addCategory}
          // Enter 없이 다른 곳(저장 단추 등)을 눌러도 쓴 분류가 빠지지 않게 한다.
          onBlur={() => addCategory(category)}
          prefix="분류:"
          placeholder="분류 이름을 쓰고 Enter (예: 생활)"
          aria-invalid={categoryInvalid || undefined}
          aria-describedby={categoryInvalid ? "doc-category-error" : undefined}
        />
        {categoryInvalid ? (
          <p id="doc-category-error" className="text-sm text-destructive">
            쓸 수 없는 분류 이름입니다({"[ ] { } | # < >"}는 제목에 쓸 수 없습니다).
          </p>
        ) : null}
      </div>
    </div>
  );
}
