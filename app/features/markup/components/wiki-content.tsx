import { Pencil } from "lucide-react";
import { Fragment, useMemo, type ReactNode } from "react";
import { Link } from "react-router";

import {
  MARK,
  NODE,
  numberAttr,
  SAFE_HREF,
  stringAttr,
  type WikiMark,
  type WikiNode,
} from "../model/doc";
import { headingId } from "../model/heading-id";
import { headingNumberMap } from "../model/heading-number";
import {
  MISSING_TEMPLATE,
  type HeadingInfo,
  type ParsedDocument,
  type RenderBlock,
} from "../model/parse";
import { pageHref, parseTitle, titleKey } from "../model/title";
import {
  FoldableSection,
  FoldToggle,
  SectionBody,
  useFoldOnHeadingClick,
} from "./section-fold";
import { TOC_ID } from "./table-of-contents";
import { cn } from "~/shared/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "~/shared/ui/popover";

interface WikiContentProps {
  document: ParsedDocument;
  /** 실제로 있는 문서의 제목 키. 여기에 없는 내부 링크는 빨간 링크다. */
  existing: ReadonlySet<string>;
  /** 문단 제목 옆 [편집]의 주소. 주지 않으면 편집 링크를 그리지 않는다(예전 판 등). */
  sectionEditHref?: (sectionIndex: number) => string;
  /** 올린 이미지를 그리는 방법. 이미지 기능이 정한다. */
  renderImage?: (imageId: string, alt: string) => ReactNode;
  /**
   * 문서 보기처럼 목차가 함께 그려지는 화면인가. 그러면 제목 번호를 눌러 목차로 돌아가고, 제목을
   * 눌러 문단을 접을 수 있다.
   */
  withToc?: boolean;
  /**
   * 다른 화면 안에 끼워 그리는 미리보기인가(편집기 안의 틀 등). 그러면 각주 목록을 그리지 않고,
   * 제목·각주에 `id`를 달지 않는다. 바깥 문서의 `id`와 겹치면 `#fn-1` 같은 이동이 틀어진다.
   */
  embedded?: boolean;
  className?: string;
}

interface RenderContext {
  existing: ReadonlySet<string>;
  renderImage?: (imageId: string, alt: string) => ReactNode;
  notes: ReadonlyMap<number, string>;
  embedded: boolean;
}

/**
 * 위키 본문을 그린다.
 *
 * 저장된 구조를 React 요소로 바로 바꾼다. 아는 노드와 마크만 그리고(모르는 것은 버린다), 주소는
 * 여기서 거른다. HTML 문자열을 거치지 않으므로 `dangerouslySetInnerHTML`이 없다.
 */
export function WikiContent({
  document,
  existing,
  sectionEditHref,
  renderImage,
  withToc = false,
  embedded = false,
  className,
}: WikiContentProps) {
  const content = useMemo(() => {
    const context: RenderContext = {
      existing,
      renderImage,
      notes: new Map(
        document.footnotes.map((footnote) => [footnote.number, footnote.note]),
      ),
      embedded,
    };
    // 목차와 같은 번호. 목차를 그리지 않을 만큼 제목이 적으면 번호도 붙이지 않는다.
    const numbers = headingNumberMap(document.headings);

    const renderHeading = (block: RenderBlock, key: number) => {
      const heading = block.heading!;
      return (
        <WikiHeading
          key={key}
          heading={heading}
          number={numbers?.get(heading.index)}
          numberLinksToToc={withToc}
          withId={!embedded}
          editHref={
            sectionEditHref && heading.sectionIndex !== null
              ? sectionEditHref(heading.sectionIndex)
              : undefined
          }
        >
          {renderInline(block.node.content ?? [], context)}
        </WikiHeading>
      );
    };

    const body = withToc
      ? renderSections(document.blocks, context, renderHeading)
      : document.blocks.map((block, index) =>
          block.heading
            ? renderHeading(block, index)
            : renderBlock(block.node, index, context),
        );

    return (
      <>
        {body}
        {document.footnotes.length > 0 && !embedded ? (
          <section data-footnotes className="wiki-footnotes">
            <h2>각주</h2>
            <ol>
              {document.footnotes.map((footnote) => (
                <li key={footnote.number} id={`fn-${footnote.number}`}>
                  <a
                    href={`#fnref-${footnote.number}`}
                    className="mr-1"
                    aria-label="본문으로 돌아가기"
                  >
                    [{footnote.number}]
                  </a>
                  <NoteText note={footnote.note} />
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </>
    );
  }, [document, existing, sectionEditHref, renderImage, withToc, embedded]);

  return <div className={cn("wiki-content", className)}>{content}</div>;
}

/**
 * 맨 바깥 제목마다 그 문단을 하나로 묶는다(문단 접기). 다음 같은 단계 제목 전까지가 한 문단이고,
 * 하위 문단은 그 안에 들어간다.
 */
function renderSections(
  blocks: readonly RenderBlock[],
  context: RenderContext,
  renderHeading: (block: RenderBlock, key: number) => ReactNode,
): ReactNode[] {
  interface Open {
    depth: number;
    children: ReactNode[];
  }
  const root: ReactNode[] = [];
  const open: { depth: number; heading: ReactNode; body: Open; key: number }[] =
    [];

  const close = () => {
    const section = open.pop()!;
    const parent = open.at(-1)?.body.children ?? root;
    parent.push(
      <FoldableSection key={`s${section.key}`} data-wiki-section="">
        {section.heading}
        <SectionBody data-section-body="">{section.body.children}</SectionBody>
      </FoldableSection>,
    );
  };

  blocks.forEach((block, index) => {
    if (block.heading) {
      while (open.length > 0 && open.at(-1)!.depth >= block.heading.depth) {
        close();
      }
      open.push({
        depth: block.heading.depth,
        heading: renderHeading(block, index),
        body: { depth: block.heading.depth, children: [] },
        key: index,
      });
      return;
    }
    const parent = open.at(-1)?.body.children ?? root;
    parent.push(renderBlock(block.node, index, context));
  });
  while (open.length > 0) close();

  return root;
}

function renderBlocks(
  nodes: readonly WikiNode[],
  context: RenderContext,
): ReactNode[] {
  return nodes.map((node, index) => renderBlock(node, index, context));
}

function renderBlock(
  node: WikiNode,
  key: number,
  context: RenderContext,
): ReactNode {
  const children = node.content ?? [];
  switch (node.type) {
    case NODE.paragraph:
      return <p key={key}>{renderInline(children, context)}</p>;
    case NODE.heading: {
      // 인용·접기 안의 제목. 문단을 나누지 않고 모양만 제목이다.
      const level = numberAttr(node, "level") ?? 2;
      const Tag = level >= 4 ? "h4" : level === 3 ? "h3" : "h2";
      return <Tag key={key}>{renderInline(children, context)}</Tag>;
    }
    case NODE.bulletList:
      return <ul key={key}>{renderBlocks(children, context)}</ul>;
    case NODE.orderedList: {
      const start = numberAttr(node, "start");
      return (
        <ol key={key} start={start && start !== 1 ? start : undefined}>
          {renderBlocks(children, context)}
        </ol>
      );
    }
    case NODE.listItem:
      return <li key={key}>{renderBlocks(children, context)}</li>;
    case NODE.blockquote:
      return (
        <blockquote key={key}>{renderBlocks(children, context)}</blockquote>
      );
    case NODE.codeBlock:
      return (
        <pre key={key}>
          <code>{children.map((child) => child.text ?? "").join("")}</code>
        </pre>
      );
    case NODE.horizontalRule:
      return <hr key={key} />;
    case NODE.table:
      // 좁은 화면에서 표가 본문 폭을 밀어내지 않게 한다.
      return (
        <div key={key} className="wiki-table-scroll">
          <table>
            <tbody>
              {children.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {(row.content ?? []).map((cell, cellIndex) => {
                    const Cell = cell.type === NODE.tableHeader ? "th" : "td";
                    const colSpan = numberAttr(cell, "colspan");
                    const rowSpan = numberAttr(cell, "rowspan");
                    return (
                      <Cell
                        key={cellIndex}
                        colSpan={colSpan && colSpan > 1 ? colSpan : undefined}
                        rowSpan={rowSpan && rowSpan > 1 ? rowSpan : undefined}
                      >
                        {renderBlocks(cell.content ?? [], context)}
                      </Cell>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case NODE.fold:
      return (
        <details key={key}>
          <summary>{stringAttr(node, "title") || "펼치기"}</summary>
          {renderBlocks(children, context)}
        </details>
      );
    case NODE.image: {
      const id = stringAttr(node, "id");
      const alt = stringAttr(node, "alt");
      return (
        <figure
          key={key}
          className="wiki-image"
          data-wiki-image={id}
          data-alt={alt}
        >
          {context.renderImage ? (
            context.renderImage(id, alt)
          ) : (
            <span className="text-muted-foreground">[이미지: {alt}]</span>
          )}
        </figure>
      );
    }
    case MISSING_TEMPLATE: {
      const title = stringAttr(node, "title");
      return (
        <p key={key}>
          <WikiLink title={title} section="" context={context}>
            {title}
          </WikiLink>
        </p>
      );
    }
    default:
      // 모르는 블록(새 판의 기능, 깨진 값)은 버린다. 안의 글자는 살린다.
      return children.length > 0 ? (
        <Fragment key={key}>{renderBlocks(children, context)}</Fragment>
      ) : null;
  }
}

function renderInline(
  nodes: readonly WikiNode[],
  context: RenderContext,
): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case NODE.text:
        return (
          <Fragment key={index}>
            {applyMarks(node.text ?? "", node.marks ?? [], context)}
          </Fragment>
        );
      case NODE.hardBreak:
        return <br key={index} />;
      case NODE.footnote: {
        const number = numberAttr(node, "number");
        return number === null ? null : (
          <FootnoteRef
            key={index}
            number={number}
            note={context.notes.get(number) ?? ""}
            embedded={context.embedded}
          />
        );
      }
      case NODE.templateParam:
        // 틀 문서 자체를 볼 때. 쓰는 문서에서는 값으로 바뀌어 여기 오지 않는다.
        return (
          <code
            key={index}
            className="wiki-template-param"
            data-template-param={numberAttr(node, "index") ?? 1}
          >
            {`{{{${numberAttr(node, "index") ?? 1}}}}`}
          </code>
        );
      default:
        return node.content ? (
          <Fragment key={index}>{renderInline(node.content, context)}</Fragment>
        ) : null;
    }
  });
}

/** 바깥에서 안으로 감싸는 순서. 링크가 가장 바깥이다. */
const MARK_ORDER: readonly string[] = [
  MARK.wikiLink,
  MARK.link,
  MARK.bold,
  MARK.italic,
  MARK.underline,
  MARK.strike,
  MARK.code,
];

function applyMarks(
  text: string,
  marks: readonly WikiMark[],
  context: RenderContext,
): ReactNode {
  const sorted = marks
    .filter((mark) => MARK_ORDER.includes(mark.type))
    .sort((a, b) => MARK_ORDER.indexOf(b.type) - MARK_ORDER.indexOf(a.type));

  return sorted.reduce<ReactNode>((inner, mark) => {
    switch (mark.type) {
      case MARK.bold:
        return <strong>{inner}</strong>;
      case MARK.italic:
        return <em>{inner}</em>;
      case MARK.underline:
        return <u>{inner}</u>;
      case MARK.strike:
        return <s>{inner}</s>;
      case MARK.code:
        return <code>{inner}</code>;
      case MARK.link: {
        const href = stringAttr(mark, "href");
        return SAFE_HREF.test(href) ? (
          <a href={href} target="_blank" rel="noopener noreferrer nofollow">
            {inner}
          </a>
        ) : (
          inner
        );
      }
      case MARK.wikiLink:
        return (
          <WikiLink
            title={stringAttr(mark, "target")}
            section={stringAttr(mark, "section")}
            context={context}
          >
            {inner}
          </WikiLink>
        );
      default:
        return inner;
    }
  }, text);
}

/**
 * 위키 문서 링크. 없는 문서면 빨간 링크다.
 *
 * `data-wiki-target`·`data-wiki-section`은 이 글을 복사해 편집기에 붙여넣을 때 위키 링크로
 * 되살리는 데 쓴다.
 */
function WikiLink({
  title: rawTitle,
  section,
  context,
  children,
}: {
  title: string;
  section: string;
  context: RenderContext;
  children: ReactNode;
}) {
  const anchor = section.trim() ? `#${encodeURI(headingId(section))}` : "";
  const title = parseTitle(rawTitle);

  // 같은 문서 안의 문단.
  if (rawTitle.trim() === "" && anchor) {
    return (
      <a href={anchor} data-wiki-target="" data-wiki-section={section}>
        {children}
      </a>
    );
  }
  if (!title) return <>{children}</>;

  const missing = !context.existing.has(titleKey(title));
  return (
    <Link
      to={`${pageHref(title)}${anchor}`}
      className={cn(missing && "wiki-link-missing")}
      title={missing ? `${title} (없는 문서)` : title}
      data-wiki-target={title}
      data-wiki-section={section || undefined}
    >
      {children}
    </Link>
  );
}

/** 각주 번호. 아래 목록으로 내려가는 대신 그 자리에 내용을 띄운다. */
function FootnoteRef({
  number,
  note,
  embedded,
}: {
  number: number;
  note: string;
  embedded: boolean;
}) {
  return (
    // `data-*`는 이 글을 복사해 편집기에 붙여넣을 때 각주로 되살리는 데 쓴다.
    <sup className="wiki-footnote-ref" data-footnote="" data-note={note}>
      <Popover>
        <PopoverTrigger
          openOnHover
          delay={150}
          closeDelay={150}
          nativeButton={false}
          render={
            <a
              href={embedded ? undefined : `#fn-${number}`}
              id={embedded ? undefined : `fnref-${number}`}
              aria-label={`각주 ${number}`}
              onClick={(event) => event.preventDefault()}
            />
          }
        >
          [{number}]
        </PopoverTrigger>
        <PopoverContent side="top" className="wiki-content wiki-footnote">
          <p>
            <NoteText note={note} />
          </p>
          {embedded ? null : (
            <a
              href={`#fn-${number}`}
              className="mt-2 block text-xs text-muted-foreground"
            >
              각주 목록으로
            </a>
          )}
        </PopoverContent>
      </Popover>
    </sup>
  );
}

const URL_IN_TEXT = /(https?:\/\/[^\s<>"]+)/g;

/** 각주 내용. 글자만 담기지만 출처 주소는 누를 수 있게 링크로 바꾼다. */
function NoteText({ note }: { note: string }) {
  return (
    <>
      {note.split(URL_IN_TEXT).map((part, index) =>
        index % 2 === 1 ? (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="break-all"
          >
            {part}
          </a>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

type HeadingTag = "h2" | "h3" | "h4";

/**
 * 문단 제목: 번호, 제목, 그리고 오른쪽 끝의 [편집]과 접기 단추.
 *
 * 단추를 제목 앞에 두면 제목 글자가 본문보다 안쪽으로 밀려 왼쪽 줄이 어긋난다. 그래서 둘 다 오른쪽
 * 끝으로 보낸다(나무위키와 같다). [편집]은 마우스를 쓰는 화면에서는 제목에 올렸을 때만 보인다.
 */
function WikiHeading({
  heading,
  number,
  numberLinksToToc,
  withId,
  editHref,
  children,
}: {
  heading: HeadingInfo;
  number?: string;
  numberLinksToToc: boolean;
  withId: boolean;
  editHref?: string;
  children?: ReactNode;
}) {
  const onClick = useFoldOnHeadingClick();
  const Tag: HeadingTag =
    heading.depth >= 4 ? "h4" : heading.depth === 3 ? "h3" : "h2";
  return (
    <Tag
      id={withId ? heading.id : undefined}
      className={cn(
        "group flex items-center gap-2",
        onClick && "cursor-pointer",
      )}
      onClick={onClick}
    >
      <span className="min-w-0 flex-1">
        {number ? (
          numberLinksToToc ? (
            <a href={`#${TOC_ID}`} className="heading-number" title="목차로">
              {number}.
            </a>
          ) : (
            <span className="heading-number">{number}.</span>
          )
        ) : null}
        {children}
      </span>
      {editHref ? (
        <Link
          to={editHref}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-normal text-muted-foreground no-underline transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:text-primary focus-visible:opacity-100 [@media(hover:hover)]:opacity-0"
        >
          <Pencil className="size-3" aria-hidden />
          편집
        </Link>
      ) : null}
      <FoldToggle label={heading.text} />
    </Tag>
  );
}
