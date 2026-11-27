import { Braces, Tag, X } from "lucide-react";
import { useState } from "react";

import type { DocMeta } from "../model/doc-io";
import { TitleInput } from "./title-input";
import { baseName, categoryTitle, type ParamMeta } from "~/features/markup";
import { Input } from "~/shared/ui/input";

/**
 * 본문 흐름 밖의 문서 정보: 분류, 틀 문서의 값 자리 설명·기본값. 편집기 위에 따로 둔다.
 *
 * 넘겨주기는 여기서 고치지 않는다. 넘겨주기 문서는 따로 된 입력(`RedirectForm`)을 쓴다.
 */
export function DocMetaFields({
  meta,
  onChange,
  paramNames = [],
}: {
  meta: DocMeta;
  onChange: (meta: DocMeta) => void;
  /** 틀 문서 본문에 있는 값 자리 이름. 있으면 설명·기본값 칸을 보인다. */
  paramNames?: readonly string[];
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
      {paramNames.length > 0 ? (
        <ParamMetaFields
          names={paramNames}
          params={meta.params ?? {}}
          onChange={(params) => onChange({ ...meta, params })}
        />
      ) : null}
    </div>
  );
}

/**
 * 틀 값: 값 자리마다 설명과 기본값. 설명은 틀을 넣는 대화상자의 칸 아래에 보인다. 기본값은 쓰는
 * 문서가 값을 비웠을 때 들어간다. 이름 목록은 본문의 값 자리에서 온다.
 */
function ParamMetaFields({
  names,
  params,
  onChange,
}: {
  names: readonly string[];
  params: Record<string, ParamMeta>;
  onChange: (params: Record<string, ParamMeta>) => void;
}) {
  const update = (name: string, field: keyof ParamMeta, value: string) =>
    onChange({ ...params, [name]: { ...params[name], [field]: value } });

  return (
    <fieldset className="grid gap-1.5 border-t pt-2.5">
      <legend className="float-left mb-1.5 flex items-center gap-1.5 text-sm font-medium">
        <Braces className="size-4" aria-hidden />틀 값
      </legend>
      <p className="clear-left text-xs text-muted-foreground">
        설명은 틀을 넣을 때 칸 아래에 보입니다. 기본값은 값을 비웠을 때
        들어갑니다. 값이 모두 빈 표 줄은 보이지 않습니다.
      </p>
      <div className="grid grid-cols-[minmax(4rem,auto)_1fr_1fr] items-center gap-x-2 gap-y-1.5 text-sm">
        <span className="text-xs text-muted-foreground">이름</span>
        <span className="text-xs text-muted-foreground">설명</span>
        <span className="text-xs text-muted-foreground">기본값</span>
        {names.map((name) => (
          <ParamRow
            key={name}
            name={name}
            meta={params[name] ?? {}}
            onChange={(field, value) => update(name, field, value)}
          />
        ))}
      </div>
    </fieldset>
  );
}

function ParamRow({
  name,
  meta,
  onChange,
}: {
  name: string;
  meta: ParamMeta;
  onChange: (field: keyof ParamMeta, value: string) => void;
}) {
  return (
    <>
      <code className="truncate font-mono text-xs">{name}</code>
      <Input
        value={meta.hint ?? ""}
        aria-label={`${name} 설명`}
        placeholder="예: 토론 문서 주소"
        onChange={(event) => onChange("hint", event.target.value)}
      />
      <Input
        value={meta.default ?? ""}
        aria-label={`${name} 기본값`}
        placeholder="없음"
        onChange={(event) => onChange("default", event.target.value)}
      />
    </>
  );
}
