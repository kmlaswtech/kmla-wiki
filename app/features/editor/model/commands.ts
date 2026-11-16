/**
 * 툴바 버튼이 하는 글자 편집. 편집기(CodeMirror)를 모르는 순수 함수라 그대로 테스트한다.
 *
 * 원칙: 글자를 선택하고 누르면 그 글자를 문법으로 감싸고, 선택 없이 누르면 예시가 들어간 문법을
 * 넣고 예시를 선택해 둔다. 바로 타이핑하면 예시가 지워진다. 문법을 외우지 않아도 쓰게 하려는 것이다.
 */

export interface TextSelection {
  from: number;
  to: number;
}

export interface TextEdit {
  /** 바꿀 범위와 넣을 글자. */
  change: { from: number; to: number; insert: string };
  /** 바꾼 뒤의 선택 범위. */
  selection: TextSelection;
}

/** 선택한 글자를 `before`와 `after`로 감싼다. 이미 감싸여 있으면 푼다. */
export function wrapSelection(
  doc: string,
  selection: TextSelection,
  before: string,
  after: string,
  placeholder: string,
): TextEdit {
  const { from, to } = selection;
  const selected = doc.slice(from, to);

  const alreadyWrapped =
    doc.slice(from - before.length, from) === before &&
    doc.slice(to, to + after.length) === after;
  if (alreadyWrapped) {
    return {
      change: {
        from: from - before.length,
        to: to + after.length,
        insert: selected,
      },
      selection: { from: from - before.length, to: to - before.length },
    };
  }

  const inner = selected === "" ? placeholder : selected;
  return {
    change: { from, to, insert: `${before}${inner}${after}` },
    selection: {
      from: from + before.length,
      to: from + before.length + inner.length,
    },
  };
}

/** 선택한 줄들의 맨 앞에 `prefix`를 붙인다(제목). 이미 같은 표시가 있으면 뗀다. */
export function toggleLinePrefix(
  doc: string,
  selection: TextSelection,
  prefix: string,
  placeholder: string,
): TextEdit {
  const lineStart = doc.lastIndexOf("\n", selection.from - 1) + 1;
  const nextBreak = doc.indexOf("\n", selection.to);
  const lineEnd = nextBreak === -1 ? doc.length : nextBreak;
  const line = doc.slice(lineStart, lineEnd);

  // 다른 단계의 제목 표시는 떼고 새 표시로 바꾼다.
  const stripped = line.replace(/^#{1,6}[ \t]+/, "");
  if (
    line.startsWith(prefix) &&
    line.length - stripped.length === prefix.length
  ) {
    return {
      change: { from: lineStart, to: lineEnd, insert: stripped },
      selection: { from: lineStart, to: lineStart + stripped.length },
    };
  }

  const text = stripped.trim() === "" ? placeholder : stripped;
  return {
    change: { from: lineStart, to: lineEnd, insert: `${prefix}${text}` },
    selection: {
      from: lineStart + prefix.length,
      to: lineStart + prefix.length + text.length,
    },
  };
}

/**
 * 블록(표, 접기, 틀)을 넣는다. 앞뒤 문단과 붙지 않게 빈 줄을 맞춘다.
 *
 * @param select 넣은 글자 안에서 선택해 둘 부분. 없으면 블록 끝에 커서를 둔다.
 */
export function insertBlock(
  doc: string,
  selection: TextSelection,
  block: string,
  select?: string,
): TextEdit {
  const before = doc.slice(0, selection.from);
  const after = doc.slice(selection.to);
  const lead =
    before === "" || before.endsWith("\n\n")
      ? ""
      : before.endsWith("\n")
        ? "\n"
        : "\n\n";
  const trail =
    after === "" || after.startsWith("\n\n")
      ? ""
      : after.startsWith("\n")
        ? "\n"
        : "\n\n";
  const insert = `${lead}${block}${trail}`;

  const start = selection.from + lead.length;
  const selectAt = select ? block.indexOf(select) : -1;
  return {
    change: { from: selection.from, to: selection.to, insert },
    selection:
      selectAt >= 0 && select
        ? { from: start + selectAt, to: start + selectAt + select.length }
        : { from: start + block.length, to: start + block.length },
  };
}

/** 글자 흐름 안에 넣는다(각주 번호, 이미지). */
export function insertInline(selection: TextSelection, text: string): TextEdit {
  return {
    change: { from: selection.from, to: selection.to, insert: text },
    selection: {
      from: selection.from + text.length,
      to: selection.from + text.length,
    },
  };
}

/** 빈 표. 첫 줄은 제목 줄이다. */
export function buildTable(rows: number, columns: number): string {
  const header = `| ${Array.from({ length: columns }, (_, i) => `제목 ${i + 1}`).join(" | ")} |`;
  const divider = `| ${Array.from({ length: columns }, () => "---").join(" | ")} |`;
  const row = `| ${Array.from({ length: columns }, () => "   ").join(" | ")} |`;
  return [header, divider, ...Array.from({ length: rows }, () => row)].join(
    "\n",
  );
}

/** 본문에서 아직 쓰지 않은 가장 작은 각주 번호. */
export function nextFootnoteNumber(doc: string): number {
  const used = new Set(
    [...doc.matchAll(/\[\^(\d+)\]/g)].map((match) => Number(match[1])),
  );
  let number = 1;
  while (used.has(number)) number++;
  return number;
}

/**
 * 각주를 단다. 커서 자리에 번호를 넣고, 문서 끝에 내용을 쓸 줄을 만든 뒤 그 내용을 선택한다.
 * 두 곳을 한 번에 고치므로 문서 전체를 돌려준다.
 */
export function addFootnote(
  doc: string,
  selection: TextSelection,
  placeholder: string,
): { doc: string; selection: TextSelection } {
  const number = nextFootnoteNumber(doc);
  const marker = `[^${number}]`;
  const withMarker = `${doc.slice(0, selection.to)}${marker}${doc.slice(selection.to)}`;
  const base = withMarker.replace(/\s+$/, "");
  const definition = `[^${number}]: `;
  const next = `${base}\n\n${definition}${placeholder}\n`;
  const from = base.length + 2 + definition.length;
  return { doc: next, selection: { from, to: from + placeholder.length } };
}
