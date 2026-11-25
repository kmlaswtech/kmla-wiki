import { parseTitle } from "~/features/markup";

/** 토론 글은 평문이다. `[[문서]]`·`[[문서|보이는 글]]`과 http(s) 주소만 링크로 바꾼다. */
export type PostSegment =
  | { type: "text"; text: string }
  | { type: "wiki"; title: string; label: string }
  | { type: "url"; href: string };

const TOKEN = /\[\[([^[\]|\n]+)(?:\|([^[\]\n]*))?\]\]|https?:\/\/[^\s<>"]+/g;

/** 주소 끝에 붙은 문장 부호는 주소가 아니다. 닫는 괄호는 여는 괄호가 주소 안에 없을 때만 뗀다. */
function trimUrl(url: string): string {
  let end = url.length;
  while (end > 0) {
    const char = url[end - 1]!;
    if (/[.,;:!?'"]/.test(char)) {
      end -= 1;
      continue;
    }
    if (char === ")") {
      const body = url.slice(0, end);
      const opens = body.split("(").length - 1;
      const closes = body.split(")").length - 1;
      if (closes > opens) {
        end -= 1;
        continue;
      }
    }
    break;
  }
  return url.slice(0, end);
}

export function parsePostText(text: string): PostSegment[] {
  const segments: PostSegment[] = [];
  let last = 0;

  const pushText = (value: string) => {
    if (value === "") return;
    const previous = segments.at(-1);
    if (previous?.type === "text") previous.text += value;
    else segments.push({ type: "text", text: value });
  };

  for (const match of text.matchAll(TOKEN)) {
    const start = match.index;
    const [whole, target, label] = match;
    pushText(text.slice(last, start));

    if (target !== undefined) {
      // `[[문서#문단]]`은 문서로만 잇는다.
      const title = parseTitle(target.split("#")[0] ?? "");
      if (title) {
        segments.push({
          type: "wiki",
          title,
          label: label?.trim() || target.trim(),
        });
      } else {
        pushText(whole);
      }
      last = start + whole.length;
      continue;
    }

    const href = trimUrl(whole);
    segments.push({ type: "url", href });
    last = start + href.length;
  }

  pushText(text.slice(last));
  return segments;
}
