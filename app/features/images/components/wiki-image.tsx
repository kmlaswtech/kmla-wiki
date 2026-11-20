import { ImageOff } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";

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
  const frame = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const path = info?.path;

  useEffect(() => {
    const element = frame.current;
    if (!element || near) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      // 화면에 들어오기 조금 전에 받기 시작한다.
      { rootMargin: "400px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);

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
      ref={frame}
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
      {url ? (
        <img
          src={url}
          alt={alt}
          width={info.width}
          height={info.height}
          className="size-full"
        />
      ) : null}
    </span>
  );
}
