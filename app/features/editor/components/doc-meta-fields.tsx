import { Tag, X } from "lucide-react";
import { useState } from "react";

import type { DocMeta } from "../model/doc-io";
import { TitleInput } from "./title-input";
import { baseName, categoryTitle } from "~/features/markup";

/**
 * 본문 흐름 밖의 문서 정보: 분류. 편집기 아래에 따로 둔다.
 *
 * 넘겨주기는 여기서 고치지 않는다. 넘겨주기 문서는 따로 된 입력(`RedirectForm`)을 쓴다.
 */
export function DocMetaFields({
  meta,
  onChange,
}: {
  meta: DocMeta;
  onChange: (meta: DocMeta) => void;
}) {
  const [category, setCategory] = useState("");

  const categoryInvalid =
    category.trim() !== "" && categoryTitle(category) === null;

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
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground coarse:p-1.5"
                  onClick={() =>
                    onChange({
                      ...meta,
                      categories: meta.categories.filter(
                        (item) => item !== title,
                      ),
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
            쓸 수 없는 분류 이름입니다({"[ ] { } | # < >"}는 제목에 쓸 수
            없습니다).
          </p>
        ) : null}
      </div>
    </div>
  );
}
