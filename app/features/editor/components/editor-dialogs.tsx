import { Extension, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { Link2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { footnoteExtensions } from "../model/schema";
import type { EditorRequest } from "./editor-ui";
import { Divider, MarkTools, ToolButton } from "./mark-tools";
import { createBox } from "./wiki-editor";
import { TitleInput } from "./title-input";
import {
  baseName,
  MARK,
  NODE,
  parseYoutubeUrl,
  SAFE_HREF,
  templateTitle,
  youtubeWatchUrl,
} from "~/features/markup";
import { resolveRedirect } from "~/features/pages";
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
import { Spinner } from "~/shared/ui/spinner";
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
        ) : shown?.kind === "youtube" ? (
          <YoutubeForm editor={editor} pos={shown.pos} onDone={close} />
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
 * 링크 삽입·편집. 문서 제목을 쓰면 위키 링크, `https://`로 시작하면 바깥 링크다.
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

  /** 넘겨주기를 확인하는 중인가. 그동안은 다시 넣지 않고 "삽입"을 막는다. */
  const [checking, setChecking] = useState(false);
  /** 확인하는 사이 대화상자가 닫혔으면 넣지 않는다. */
  const closed = useRef(false);
  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
    };
  }, []);

  const apply = async (value: string) => {
    const address = value.trim();
    if (!address || checking) return;
    const href = asExternalHref(address);
    const [rawTitle = "", ...rest] = address.split("#");
    let title = rawTitle.trim();
    // 넘겨주기 문서를 가리키면 끝까지 따라가 최종 문서에 건다. 링크가 넘겨주기 문서를 거치지 않게
    // 한다. 보이는 글자는 친 그대로 둔다. 최종 문서를 찾지 못하면 친 이름에 건다.
    if (!href && title !== "") {
      setChecking(true);
      const resolved = await resolveRedirect(title).catch(() => null);
      if (closed.current) return;
      setChecking(false);
      if (resolved?.status === "page") title = resolved.title;
    }
    const mark = href
      ? { type: MARK.link, attrs: { href } }
      : {
          type: MARK.wikiLink,
          attrs: { target: title, section: rest.join("#").trim() },
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
      title={editing ? "링크 편집" : "링크 삽입"}
      description="문서 이름을 쓰면 위키 문서로, https://로 시작하면 바깥 사이트로 갑니다. 문서의 한 문단으로 가려면 '문서 이름#문단 제목'처럼 씁니다."
      onSubmit={() => void apply(target)}
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
              링크 제거
            </Button>
          ) : null}
          <Button type="submit" disabled={target.trim() === "" || checking}>
            {checking ? <Spinner /> : null}
            {editing ? "저장" : "삽입"}
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
          onCommit={needsLabel ? undefined : (value) => void apply(value)}
          sections
          wikiAddresses
          placeholder="예: 귀가, 귀가#신청, https://kmla.hs.kr"
          focusOnMount
        />
      </div>
      {needsLabel ? (
        <div className="grid gap-1.5">
          <Label htmlFor="link-label">표시할 텍스트 (선택)</Label>
          <Input
            id="link-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </div>
      ) : selectedText ? (
        <p className="text-sm text-muted-foreground">
          선택한 텍스트:{" "}
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

/** 틀 삽입·편집. 값은 한 줄에 하나씩 적는다(틀 문서의 {{{1}}}, {{{2}}} 자리에 차례로 들어간다). */
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
      title={current ? "틀 설정" : "틀 삽입"}
      description="틀의 공통 내용은 틀 문서에서 편집할 수 있습니다."
      onSubmit={submit}
      footer={
        <>
          {current ? (
            <RemoveNodeButton editor={editor} target={current} onDone={onDone}>
              틀 제거
            </RemoveNodeButton>
          ) : null}
          <Button type="submit" disabled={title === null}>
            {current ? "저장" : "삽입"}
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
        <Label htmlFor="template-values">매개변수 (선택, 한 줄에 하나)</Label>
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

/** 각주 편집기의 키. Enter는 줄바꿈이다(각주는 문단 하나다). */
const FootnoteKeys = Extension.create<{
  submit: () => void;
  link: () => void;
}>({
  name: "footnoteKeys",
  // 줄바꿈 확장의 `Mod-Enter`보다 먼저 받는다.
  priority: 1000,

  addOptions() {
    return { submit: () => undefined, link: () => undefined };
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => editor.commands.setHardBreak(),
      "Mod-Enter": () => {
        this.options.submit();
        return true;
      },
      "Mod-k": () => {
        this.options.link();
        return true;
      },
    };
  },
});

/** 보이는 내용이 없는가(글자가 비었거나 공백뿐이고, 값 자리도 없다). */
function isBlankNote(doc: PMNode): boolean {
  let blank = true;
  doc.descendants((node) => {
    if (node.type.name === NODE.templateParam || node.text?.trim()) {
      blank = false;
    }
    return blank;
  });
  return blank;
}

/**
 * 각주 삽입·편집. 내용은 작은 편집기에서 꾸밈과 링크까지 넣을 수 있다.
 *
 * 링크 넣기는 대화상자를 바꾸지 않고 이 안에서 화면만 바꾼다. 대화상자는 하나만 열리므로
 * `request({ kind: "link" })`로 열면 쓰던 각주가 사라진다. 각주 편집기는 숨기기만 하고 내리지 않는다.
 */
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
  const [view, setView] = useState<"note" | "link">("note");

  // 편집기의 키가 부를 함수. 편집기는 한 번만 만들므로 상자에 최신 함수를 두고, 키를 누를 때(렌더
  // 밖에서) 읽는다.
  const [keys] = useState(() =>
    createBox({ submit: () => {}, link: () => {} }),
  );
  const [extensions] = useState(() => [
    ...footnoteExtensions(),
    FootnoteKeys.configure({
      submit: () => keys.current.submit(),
      link: () => keys.current.link(),
    }),
  ]);
  const note = useEditor({
    extensions,
    content: {
      type: "doc",
      content: [
        {
          type: NODE.paragraph,
          content: current?.node.content.toJSON() ?? [],
        },
      ],
    },
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    autofocus: "end",
    editorProps: {
      attributes: {
        "aria-label": "각주 내용",
        class: "wiki-content wiki-footnote min-h-16 px-3 py-2 outline-none",
      },
    },
  });
  const blank = useEditorState({
    editor: note,
    selector: ({ editor: inner }) => !inner || isBlankNote(inner.state.doc),
  });

  const submit = () => {
    if (!note || isBlankNote(note.state.doc)) return;
    // 두 편집기는 꾸밈 정의가 같으므로 JSON 그대로 옮긴다.
    const content = note.state.doc.firstChild?.content.toJSON() ?? [];
    // 고치던 각주가 있으면 그 자리를 바꾸고, 없으면 커서 자리에 넣는다.
    editor
      .chain()
      .focus()
      .insertContentAt(
        current
          ? { from: current.pos, to: current.pos + current.node.nodeSize }
          : editor.state.selection,
        { type: NODE.footnote, attrs: current?.node.attrs, content },
      )
      .run();
    onDone();
  };
  const openLink = () => setView("link");
  useEffect(() => {
    keys.update({ submit, link: openLink });
  });

  return (
    <>
      {/* `hidden`은 화면에서도, 화면 읽기 프로그램에서도 숨긴다(제목이 둘로 읽히지 않는다). */}
      <div className="contents" hidden={view !== "note"}>
        <DialogForm
          title={current ? "각주 편집" : "각주 삽입"}
          onSubmit={submit}
          footer={
            <>
              {current ? (
                <RemoveNodeButton
                  editor={editor}
                  target={current}
                  onDone={onDone}
                >
                  각주 삭제
                </RemoveNodeButton>
              ) : null}
              <Button type="submit" disabled={blank}>
                {current ? "저장" : "삽입"}
              </Button>
            </>
          }
        >
          {note ? (
            <div className="grid gap-1.5">
              <div className="overflow-hidden rounded-md border focus-within:ring-2 focus-within:ring-ring/50">
                <div
                  role="toolbar"
                  aria-label="각주 꾸밈"
                  className="flex flex-wrap items-center gap-0.5 border-b bg-muted/90 p-1"
                >
                  <MarkTools editor={note} />
                  <Divider />
                  <ToolButton label="링크" onClick={openLink}>
                    <Link2 />
                  </ToolButton>
                </div>
                <EditorContent editor={note} />
              </div>
              <p className="text-xs text-muted-foreground">
                Enter는 줄바꿈, Ctrl+Enter는 {current ? "저장" : "삽입"}입니다.
              </p>
            </div>
          ) : null}
        </DialogForm>
      </div>
      {view === "link" && note ? (
        <LinkForm
          editor={note}
          onDone={() => {
            setView("note");
            requestAnimationFrame(() => note.commands.focus());
          }}
        />
      ) : null}
    </>
  );
}

/**
 * 유튜브 영상 삽입·편집. 주소의 시작 시각(`t=90`)도 읽는다. 크기와 정렬은 넣은 뒤 영상 아래에서
 * 고른다.
 */
function YoutubeForm({
  editor,
  pos,
  onDone,
}: {
  editor: Editor;
  pos?: number;
  onDone: () => void;
}) {
  const current = nodeTargetAt(editor, pos, NODE.youtube);
  const [address, setAddress] = useState(
    current
      ? youtubeWatchUrl({
          videoId: String(current.node.attrs.videoId ?? ""),
          start: Number(current.node.attrs.start ?? 0),
        })
      : "",
  );
  const video = parseYoutubeUrl(address);
  const invalid = address.trim() !== "" && video === null;

  const submit = () => {
    if (!video) return;
    // 고칠 때는 고른 크기·정렬을 그대로 둔다.
    upsertNode(editor, current, NODE.youtube, {
      size: "small",
      ...current?.node.attrs,
      videoId: video.videoId,
      start: video.start,
    });
    onDone();
  };

  return (
    <DialogForm
      title={current ? "유튜브 영상 설정" : "유튜브 영상 삽입"}
      description="주소에 시작 시간이 있으면 해당 위치부터 재생합니다. 예를 들어 ?t=90은 1분 30초부터 재생합니다."
      onSubmit={submit}
      footer={
        <>
          {current ? (
            <RemoveNodeButton editor={editor} target={current} onDone={onDone}>
              영상 제거
            </RemoveNodeButton>
          ) : null}
          <Button type="submit" disabled={video === null}>
            {current ? "저장" : "삽입"}
          </Button>
        </>
      }
    >
      <div className="grid gap-1.5">
        <Label htmlFor="youtube-address">영상 주소</Label>
        <Input
          id="youtube-address"
          // `type="url"`이면 `https://`를 뺀 주소(`youtu.be/…`)를 브라우저가 막는다. 주소는
          // `parseYoutubeUrl`이 검사한다.
          type="text"
          inputMode="url"
          value={address}
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- 대화상자를 열자마자 붙여넣을 수 있게 한다.
          autoFocus
          placeholder="예: https://youtu.be/…"
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? "youtube-address-error" : undefined}
          onChange={(event) => setAddress(event.target.value)}
        />
        {invalid ? (
          <p id="youtube-address-error" className="text-sm text-destructive">
            유튜브 영상 주소가 아닙니다.
          </p>
        ) : null}
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
      title="표 삽입"
      description="첫 행은 머리글입니다."
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
      footer={<Button type="submit">삽입</Button>}
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="table-rows">행</Label>
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
          <Label htmlFor="table-columns">열</Label>
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
