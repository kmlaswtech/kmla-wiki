import { ImageOff } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";

import { loadImageUrl } from "../data/files";
import type { ImageInfo } from "../data/queries";

interface WikiImageProps {
  /** 이미지 정보. 지워졌거나 없는 이미지면 `undefined`. */
  info: ImageInfo | undefined;
  alt: string;
}

/**
 * 본문 속 이미지 한 장.
 *
 * 화면 가까이 왔을 때에야 받는다(긴 문서 아래쪽 이미지를 미리 받지 않는다). 받기 전에도 원래
 * 비율로 자리를 잡아 두어, 이미지가 뜰 때 글이 밀리지 않는다.
 */
export function WikiImage({ info, alt }: WikiImageProps) {
  // 상자는 state로 받는다. 정보가 늦게 오면(임시 저장을 불러온 편집 화면, 방금 올린 이미지) 처음에는
  // 상자가 없다. 상자가 생기는 때 지켜보기 시작해야 한다(ref 객체로는 그때를 알 수 없다).
  const [frame, setFrame] = useState<HTMLSpanElement | null>(null);
  const [near, setNear] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const path = info?.path;

  useEffect(() => {
    if (!frame || near) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      // 화면에 들어오기 조금 전에 받기 시작한다.
      { rootMargin: "400px" },
    );
    observer.observe(frame);
    return () => observer.disconnect();
  }, [frame, near]);

  useEffect(() => {
    if (!path || !near) return;
    let objectUrl: string | null = null;
    let cancelled = false;

    loadImageUrl(path)
      .then((next) => {
        if (cancelled) {
          URL.revokeObjectURL(next);
          return;
        }
        objectUrl = next;
        setUrl(next);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, near]);

  if (!info || failed) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm text-muted-foreground">
        <ImageOff className="size-4" aria-hidden />
        {alt || "이미지"} (불러올 수 없음)
      </span>
    );
  }

  return (
    <span
      ref={setFrame}
      // 폭·모서리는 본문의 크기 고르기·캡션(`.wiki-image-frame`, app.css)이 정한다. 원본 폭은 변수로만
      // 넘긴다. 폭을 인라인 스타일이나 유틸리티 클래스로 주면 그 규칙들이 이기지 못한다.
      className="wiki-image-frame"
      style={
        {
          "--image-width": `${info.width}px`,
          aspectRatio: `${info.width} / ${info.height}`,
        } as CSSProperties
      }
    >
      {/* 받기 전에는 같은 크기의 빈 그림을 둔다. 그러면 받기 전에도 그림이 원본 크기를 가진다
          (표 칸은 이 크기로 폭을 정한다, app.css). 크기는 `.wiki-image-frame > img`가 정한다. */}
      <img
        src={url ?? placeholderSrc(info.width, info.height)}
        alt={alt}
        width={info.width}
        height={info.height}
      />
    </span>
  );
}

/** 이 크기의 투명한 빈 그림. 받는 것이 없다(data URI). */
function placeholderSrc(width: number, height: number): string {
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"/>`,
  )}`;
}
