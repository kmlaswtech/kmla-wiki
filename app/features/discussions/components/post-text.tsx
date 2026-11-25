import { useMemo } from "react";
import { Link } from "react-router";

import { parsePostText } from "../model/post-text";
import { pageHref } from "~/features/markup";

/** 토론 글 본문. 줄바꿈은 그대로 두고 `[[문서]]`와 주소만 링크로 그린다. */
export function PostText({ text }: { text: string }) {
  const segments = useMemo(() => parsePostText(text), [text]);
  return (
    <p className="break-words whitespace-pre-wrap">
      {segments.map((segment, index) => {
        if (segment.type === "text") return segment.text;
        if (segment.type === "wiki") {
          return (
            <Link
              key={index}
              to={pageHref(segment.title)}
              className="text-primary hover:underline"
            >
              {segment.label}
            </Link>
          );
        }
        return (
          <a
            key={index}
            href={segment.href}
            target="_blank"
            // 회원이 쓴 바깥 주소다. 검색 엔진에 점수를 주지 않고, 연 창이 이 창을 건드리지 못하게 한다.
            rel="nofollow ugc noopener noreferrer"
            className="break-all text-primary hover:underline"
          >
            {segment.href}
          </a>
        );
      })}
    </p>
  );
}
