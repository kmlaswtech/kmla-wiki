import type { Root as HastRoot } from "hast";
import { toJsxRuntime, type Components } from "hast-util-to-jsx-runtime";
import { Pencil } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Link } from "react-router";

import { headingNumberMap } from "../model/heading-number";
import type { ParsedDocument } from "../model/parse";
import { IMAGE_SCHEME, WIKI_SCHEME } from "../model/syntax";
import { pageHref, titleKey } from "../model/title";
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
  /** 문단 제목 옆 [편집]의 주소. 주지 않으면 편집 링크를 그리지 않는다(미리보기, 예전 판). */
  sectionEditHref?: (headingIndex: number) => string;
  /** 올린 이미지를 그리는 방법. 이미지 기능이 정한다. */
  renderImage?: (imageId: string, alt: string) => ReactNode;
  /**
   * 문서 보기처럼 목차가 함께 그려지는 화면인가. 그러면 제목 번호를 눌러 목차로 돌아가고, 제목을
   * 눌러 문단을 접을 수 있다. 미리보기는 끈다.
   */
  withToc?: boolean;
  className?: string;
}

type HeadingTag = "h2" | "h3" | "h4" | "h5" | "h6";

interface ElementProps {
  children?: ReactNode;
  [attribute: string]: unknown;
}

/**
 * 위키 본문을 그린다.
 *
 * 트리에는 원시 HTML이 없고 주소는 `parseWiki`가 이미 걸렀다. 여기서는 `dangerouslySetInnerHTML`
 * 없이 React 요소로만 바꾼다.
 */
export function WikiContent({
  document,
  existing,
  sectionEditHref,
  renderImage,
  withToc = false,
  className,
}: WikiContentProps) {
  const content = useMemo(() => {
    // 목차와 같은 번호. 목차를 그리지 않을 만큼 제목이 적으면 번호도 붙이지 않는다.
    const numbers = headingNumberMap(document.headings);
    const headingText = new Map(
      document.headings.map((heading) => [heading.index, heading.text]),
    );

    const heading = (Tag: HeadingTag) =>
      function Heading({ children, id, ...props }: ElementProps) {
        const index = Number(props["data-heading-index"]);
        const known = Number.isInteger(index);
        return (
          <WikiHeading
            Tag={Tag}
            id={typeof id === "string" ? id : undefined}
            label={(known && headingText.get(index)) || ""}
            number={known ? numbers?.get(index) : undefined}
            numberLinksToToc={withToc}
            editHref={
              sectionEditHref && known ? sectionEditHref(index) : undefined
            }
          >
            {children}
          </WikiHeading>
        );
      };

    /** 각주 내용을 본문과 같은 규칙으로 그린다(위키 링크, 빨간 링크). */
    const renderFootnote = (id: string) => {
      const children = document.footnotes.get(id);
      if (!children) return null;
      const root: HastRoot = { type: "root", children };
      return toJsxRuntime(root, { Fragment, jsx, jsxs, components });
    };

    const components: Components = {
      a({ href, children, ...props }) {
        if (typeof href !== "string") return <span>{children}</span>;
        const elementId = typeof props.id === "string" ? props.id : undefined;

        if (href.startsWith(WIKI_SCHEME)) {
          const [encodedTitle = "", anchor] = href
            .slice(WIKI_SCHEME.length)
            .split("#");
          const title = decodeURIComponent(encodedTitle);
          const missing = !existing.has(titleKey(title));
          return (
            <Link
              to={`${pageHref(title)}${anchor ? `#${anchor}` : ""}`}
              className={cn(missing && "wiki-link-missing")}
              title={missing ? `${title} (없는 문서)` : title}
            >
              {children}
            </Link>
          );
        }

        // 각주 번호. 아래 목록으로 내려가는 대신 그 자리에 내용을 띄운다.
        if (
          href.startsWith("#") &&
          (props as ElementProps)["data-footnote-ref"] !== undefined
        ) {
          const footnoteId = decodeURIComponent(href.slice(1));
          const body = renderFootnote(footnoteId);
          if (body) {
            return (
              <Popover>
                <PopoverTrigger
                  openOnHover
                  delay={150}
                  closeDelay={150}
                  nativeButton={false}
                  render={
                    <a
                      href={href}
                      id={elementId}
                      aria-label={`각주 ${String(children)}`}
                      onClick={(event) => event.preventDefault()}
                    />
                  }
                >
                  {children}
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  className="wiki-content wiki-footnote"
                >
                  {body}
                  <a
                    href={href}
                    className="mt-2 block text-xs text-muted-foreground"
                  >
                    각주 목록으로
                  </a>
                </PopoverContent>
              </Popover>
            );
          }
        }

        if (href.startsWith("#")) {
          return (
            <a href={href} id={elementId}>
              {children}
            </a>
          );
        }

        return (
          <a href={href} target="_blank" rel="noopener noreferrer nofollow">
            {children}
          </a>
        );
      },
      img({ src, alt }) {
        const id =
          typeof src === "string" && src.startsWith(IMAGE_SCHEME)
            ? src.slice(IMAGE_SCHEME.length)
            : null;
        if (!id) return null;
        return renderImage ? (
          renderImage(id, alt ?? "")
        ) : (
          <span className="text-muted-foreground">[이미지: {alt}]</span>
        );
      },
      table({ children }) {
        // 좁은 화면에서 표가 본문 폭을 밀어내지 않게 한다.
        return (
          <div className="wiki-table-scroll">
            <table>{children}</table>
          </div>
        );
      },
      section({ children, ...props }) {
        const attributes = props as ElementProps;
        if (withToc && attributes["data-wiki-section"] !== undefined) {
          return <FoldableSection {...attributes}>{children}</FoldableSection>;
        }
        return <section {...attributes}>{children}</section>;
      },
      div({ children, ...props }) {
        const attributes = props as ElementProps;
        if (withToc && attributes["data-section-body"] !== undefined) {
          return <SectionBody {...attributes}>{children}</SectionBody>;
        }
        return <div {...attributes}>{children}</div>;
      },
      h2: heading("h2"),
      h3: heading("h3"),
      h4: heading("h4"),
      h5: heading("h5"),
      h6: heading("h6"),
    };

    return toJsxRuntime(document.tree, {
      Fragment,
      jsx,
      jsxs,
      components,
    });
  }, [document, existing, sectionEditHref, renderImage, withToc]);

  return <div className={cn("wiki-content", className)}>{content}</div>;
}

/** 문단 제목: 접기 단추, 번호, 제목, [편집]. */
function WikiHeading({
  Tag,
  id,
  label,
  number,
  numberLinksToToc,
  editHref,
  children,
}: {
  Tag: HeadingTag;
  id?: string;
  label: string;
  number?: string;
  numberLinksToToc: boolean;
  editHref?: string;
  children?: ReactNode;
}) {
  const onClick = useFoldOnHeadingClick();
  return (
    <Tag
      id={id}
      className={cn("group scroll-mt-16", onClick && "cursor-pointer")}
      onClick={onClick}
    >
      <FoldToggle label={label} />
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
      {editHref ? (
        <Link
          to={editHref}
          className="ml-2 inline-flex items-center gap-1 align-middle text-xs font-normal text-muted-foreground no-underline hover:text-primary"
        >
          <Pencil className="size-3" aria-hidden />
          편집
        </Link>
      ) : null}
    </Tag>
  );
}
