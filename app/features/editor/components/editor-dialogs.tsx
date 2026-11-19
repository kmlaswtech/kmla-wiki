import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { useState, type ReactNode } from "react";

import type { EditorRequest } from "./editor-ui";
import { TitleInput } from "./title-input";
import {
  baseName,
  MARK,
  NODE,
  SAFE_HREF,
  templateTitle,
} from "~/features/markup";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { Input } from "~/shared/ui/input";
import { Label } from "~/shared/ui/label";
import { Textarea } from "~/shared/ui/textarea";

/**
 * 편집기의 대화상자. 하나만 열리고, 닫히면 편집기로 초점을 돌린다.
 *
 * 대화상자는 화면에서는 따로 떠 있지만 React 트리에서는 편집 폼 안이다. 제출을 막지 않으면 바깥
 * 폼까지 올라가 문서가 저장되므로, 모든 폼에서 전파를 끊는다.
 */
export function EditorDialogs({
  editor,
  request,
  onClose,
}: {
  editor: Editor;
  request: EditorRequest | null;
  onClose: () => void;
}) {
  const close = () => {
    onClose();
    editor.commands.focus();
  };

  // 닫히는 동안(사라지는 애니메이션)에도 마지막 내용을 그대로 그린다. 닫힐 때 내용을 바꾸거나
  // 다시 만들면 애니메이션이 끝나지 않아, 빈 대화상자의 덮개가 화면을 막는다.
  const [shown, setShown] = useState(request);
  const [opened, setOpened] = useState(0);
  if (request !== null && request !== shown) {
    setShown(request);
    // 열 때마다 새로 만들어 이전 입력이 남지 않게 한다.
    setOpened((count) => count + 1);
  }

  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent key={opened} className="sm:max-w-md">
        {shown?.kind === "link" ? (
          <LinkForm editor={editor} onDone={close} />
        ) : shown?.kind === "template" ? (
          <TemplateForm editor={editor} pos={shown.pos} onDone={close} />
        ) : shown?.kind === "footnote" ? (
          <FootnoteForm editor={editor} pos={shown.pos} onDone={close} />
        ) : shown?.kind === "table" ? (
          <TableForm editor={editor} onDone={close} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DialogForm({
  title,
  description,
  onSubmit,
  children,
  footer,
}: {
  title: string;
  description?: string;
  onSubmit: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onSubmit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description ? (
          <DialogDescription>{description}</DialogDescription>
        ) : null}
      </DialogHeader>
      <div className="grid gap-3">{children}</div>
      <DialogFooter>{footer}</DialogFooter>
    </form>
  );
}

/** 바깥 주소처럼 생겼는가. 아니면 위키 문서 제목으로 본다. */
function asExternalHref(value: string): string | null {
  if (SAFE_HREF.test(value)) return value;
  if (/^www\.[^\s]+\.[^\s]+$/i.test(value)) return `https://${value}`;
  return null;
}

/**
 * 링크 넣기·고치기. 문서 제목을 쓰면 위키 링크, `https://`로 시작하면 바깥 링크다.
 * 글자를 골라 두었으면 그 글자에, 아니면 새 글자로 넣는다.
 */
function LinkForm({ editor, onDone }: { editor: Editor; onDone: () => void }) {
  // 커서가 놓인 링크의 종류. 링크 밖이면 `null`.
  const activeMark = editor.isActive(MARK.link)
    ? MARK.link
    : editor.isActive(MARK.wikiLink)
      ? MARK.wikiLink
      : null;
  const editing = activeMark !== null;
  const attrs = activeMark ? editor.getAttributes(activeMark) : {};
  const initialTarget =
    activeMark === MARK.link
      ? String(attrs.href ?? "")
      : [attrs.target, attrs.section].filter(Boolean).join("#");

  const { from, to, empty } = editor.state.selection;
  const selectedText = editor.state.doc.textBetween(from, to, " ");
  const [target, setTarget] = useState(initialTarget);
  const [label, setLabel] = useState("");
  const needsLabel = empty && !editing;

  const apply = (value: string) => {
    const address = value.trim();
    if (!address) return;
    const href = asExternalHref(address);
    const [title = "", ...rest] = address.split("#");
    const mark = href
      ? { type: MARK.link, attrs: { href } }
      : {
          type: MARK.wikiLink,
          attrs: { target: title.trim(), section: rest.join("#").trim() },
        };

    const chain = editor.chain().focus();
    if (needsLabel) {
      const text = label.trim() || (href ? address : address.replace(/^#/, ""));
      chain
        .insertContent({ type: NODE.text, text, marks: [mark] })
        .unsetMark(mark.type)
        .run();
    } else {
      if (activeMark && empty) chain.extendMarkRange(activeMark);
      chain
        .unsetMark(MARK.link)
        .unsetMark(MARK.wikiLink)
        .setMark(mark.type, mark.attrs)
        .run();
    }
    onDone();
  };

  return (
    <DialogForm
      title={editing ? "링크 고치기" : "링크 넣기"}
      description="문서 이름을 쓰면 위키 문서로, https://로 시작하면 바깥 사이트로 갑니다. 문서의 한 문단으로 가려면 '문서 이름#문단 제목'처럼 씁니다."
      onSubmit={() => apply(target)}
      footer={
        <>
          {activeMark ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                editor
                  .chain()
                  .focus()
                  .extendMarkRange(activeMark)
                  .unsetMark(MARK.link)
                  .unsetMark(MARK.wikiLink)
                  .run();
                onDone();
              }}
            >
              링크 없애기
            </Button>
          ) : null}
          <Button type="submit" disabled={target.trim() === ""}>
            {editing ? "고치기" : "넣기"}
          </Button>
        </>
      }
    >
      <div className="grid gap-1.5">
        <Label htmlFor="link-target">문서 이름 또는 주소</Label>
        <TitleInput
          id="link-target"
          value={target}
          onChange={setTarget}
          onCommit={needsLabel ? undefined : apply}
          sections
          placeholder="예: 귀가, 귀가#신청, https://kmla.hs.kr"
          focusOnMount
        />
      </div>
      {needsLabel ? (
        <div className="grid gap-1.5">
          <Label htmlFor="link-label">보여 줄 글자 (선택)</Label>
          <Input
            id="link-label"
            value={label}
            placeholder="비워 두면 문서 이름이 보입니다"
            onChange={(event) => setLabel(event.target.value)}
          />
        </div>
      ) : selectedText ? (
        <p className="text-sm text-muted-foreground">
          고른 글자:{" "}
          <span className="font-medium text-foreground">{selectedText}</span>
        </p>
      ) : null}
    </DialogForm>
  );
}

/** 고치려고 연 노드와 그 자리. */
interface NodeTarget {
  node: PMNode;
  pos: number;
}

/** `pos`에 `type` 노드가 있으면 그것을 고친다. 없으면 새로 넣는 중이다(`null`). */
function nodeTargetAt(
  editor: Editor,
  pos: number | undefined,
  type: string,
): NodeTarget | null {
  if (pos === undefined) return null;
  const node = editor.state.doc.nodeAt(pos);
  return node?.type.name === type ? { node, pos } : null;
}

/** 고치던 노드의 속성을 바꾸거나, 새 노드를 커서 자리에 넣는다. */
function upsertNode(
  editor: Editor,
  target: NodeTarget | null,
  type: string,
  attrs: Record<string, unknown>,
) {
  const chain = editor.chain().focus();
  if (target) {
    chain
      .command(({ tr }) => {
        tr.setNodeMarkup(target.pos, undefined, attrs);
        return true;
      })
      .run();
  } else {
    chain.insertContent({ type, attrs }).run();
  }
}

/** 고치던 노드를 빼는 단추. */
function RemoveNodeButton({
  editor,
  target,
  onDone,
  children,
}: {
  editor: Editor;
  target: NodeTarget;
  onDone: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => {
        editor
          .chain()
          .focus()
          .deleteRange({
            from: target.pos,
            to: target.pos + target.node.nodeSize,
          })
          .run();
        onDone();
      }}
    >
      {children}
    </Button>
  );
}

/** 틀 넣기·고치기. 값은 한 줄에 하나씩 적는다(틀 문서의 {{{1}}}, {{{2}}} 자리에 차례로 들어간다). */
function TemplateForm({
  editor,
  pos,
  onDone,
}: {
  editor: Editor;
  pos?: number;
  onDone: () => void;
}) {
  const current = nodeTargetAt(editor, pos, NODE.template);
  const [name, setName] = useState(
    current ? baseName(String(current.node.attrs.name ?? "")) : "",
  );
  const [values, setValues] = useState(
    current
      ? ((current.node.attrs.args as string[] | undefined) ?? []).join("\n")
      : "",
  );

  const title = name.trim() === "" ? null : templateTitle(name);
  const invalid = name.trim() !== "" && title === null;

  const submit = () => {
    if (!title) return;
    upsertNode(editor, current, NODE.template, {
      name: title,
      args: values === "" ? [] : values.split("\n").map((line) => line.trim()),
    });
    onDone();
  };

  return (
    <DialogForm
      title={current ? "틀 고치기" : "틀 넣기"}
      description="틀 문서의 내용이 이 자리에 들어갑니다. 내용을 고치려면 틀 문서를 고칩니다."
      onSubmit={submit}
      footer={
        <>
          {current ? (
            <RemoveNodeButton editor={editor} target={current} onDone={onDone}>
              틀 빼기
            </RemoveNodeButton>
          ) : null}
          <Button type="submit" disabled={title === null}>
            {current ? "고치기" : "넣기"}
          </Button>
        </>
      }
    >
      <div className="grid gap-1.5">
        <Label htmlFor="template-name">틀 이름</Label>
        <TitleInput
          id="template-name"
          value={name}
          onChange={setName}
          prefix="틀:"
          placeholder="예: 오래된 정보"
          focusOnMount
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? "template-name-error" : undefined}
        />
        {invalid ? (
          <p id="template-name-error" className="text-sm text-destructive">
            쓸 수 없는 이름입니다({"[ ] { } | # < >"}는 제목에 쓸 수 없습니다).
          </p>
        ) : null}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="template-values">넘길 값 (선택, 한 줄에 하나)</Label>
        <Textarea
          id="template-values"
          value={values}
          rows={3}
          onChange={(event) => setValues(event.target.value)}
        />
      </div>
    </DialogForm>
  );
}

/** 각주 넣기·고치기. 출처 주소를 적으면 문서에서 누를 수 있는 링크가 된다. */
function FootnoteForm({
  editor,
  pos,
  onDone,
}: {
  editor: Editor;
  pos?: number;
  onDone: () => void;
}) {
  const current = nodeTargetAt(editor, pos, NODE.footnote);
  const [note, setNote] = useState(
    current ? String(current.node.attrs.note ?? "") : "",
  );

  const submit = () => {
    const text = note.trim();
    if (!text) return;
    upsertNode(editor, current, NODE.footnote, { note: text });
    onDone();
  };

  return (
    <DialogForm
      title={current ? "각주 고치기" : "각주 넣기"}
      description="문장 끝에 번호가 붙고, 내용은 문서 맨 아래에 모입니다."
      onSubmit={submit}
      footer={
        <>
          {current ? (
            <RemoveNodeButton editor={editor} target={current} onDone={onDone}>
              각주 지우기
            </RemoveNodeButton>
          ) : null}
          <Button type="submit" disabled={note.trim() === ""}>
            {current ? "고치기" : "넣기"}
          </Button>
        </>
      }
    >
      <div className="grid gap-1.5">
        <Label htmlFor="footnote-note">각주 내용</Label>
        <Textarea
          id="footnote-note"
          value={note}
          rows={3}
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- 대화상자를 열자마자 칠 수 있게 한다.
          autoFocus
          placeholder="예: 2026년 기준. https://…"
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            // 여러 줄은 받지 않는다. Enter는 넣기다.
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
      </div>
    </DialogForm>
  );
}

function clamp(value: string, min: number, max: number): number {
  const number = Number.parseInt(value, 10);
  return Number.isNaN(number) ? min : Math.min(Math.max(number, min), max);
}

function TableForm({ editor, onDone }: { editor: Editor; onDone: () => void }) {
  const [rows, setRows] = useState("3");
  const [columns, setColumns] = useState("3");

  return (
    <DialogForm
      title="표 넣기"
      description="첫 줄은 제목 줄입니다. 줄과 칸은 나중에 표 메뉴에서 더하거나 뺄 수 있습니다."
      onSubmit={() => {
        editor
          .chain()
          .focus()
          .insertTable({
            rows: clamp(rows, 1, 30),
            cols: clamp(columns, 1, 10),
            withHeaderRow: true,
          })
          .run();
        onDone();
      }}
      footer={<Button type="submit">넣기</Button>}
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="table-rows">줄</Label>
          <Input
            id="table-rows"
            type="number"
            min={1}
            max={30}
            value={rows}
            onChange={(event) => setRows(event.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="table-columns">칸</Label>
          <Input
            id="table-columns"
            type="number"
            min={1}
            max={10}
            value={columns}
            onChange={(event) => setColumns(event.target.value)}
          />
        </div>
      </div>
    </DialogForm>
  );
}
