import { NODE, stringAttr, type WikiNode } from "./doc";

/**
 * 이미지·영상의 크기와 정렬. 이미지 노드와 유튜브 노드가 같은 값을 쓴다.
 *
 * 크기는 고른 몇 가지만 둔다. 숫자를 마음대로 넣게 하면 좁은 화면에서 깨지기 쉽다. 어느 크기든
 * 본문 폭을 넘지 않는다. 글자가 옆으로 흐르게 하는 배치(float)는 두지 않는다. 폰에서는 옆에 둘
 * 자리가 없다.
 */
export const MEDIA_SIZES = ["small", "medium", "large", "full"] as const;
export type MediaSize = (typeof MEDIA_SIZES)[number];

export const MEDIA_ALIGNS = ["left", "center", "right"] as const;
export type MediaAlign = (typeof MEDIA_ALIGNS)[number];

export const MEDIA_SIZE_LABEL: Record<MediaSize, string> = {
  small: "작게",
  medium: "중간",
  large: "크게",
  full: "본문 폭",
};

export const MEDIA_ALIGN_LABEL: Record<MediaAlign, string> = {
  left: "왼쪽",
  center: "가운데",
  right: "오른쪽",
};

/** 크기를 고르지 않은 유튜브 영상의 크기. */
export const DEFAULT_VIDEO_SIZE: MediaSize = "large";

export function isMediaSize(value: unknown): value is MediaSize {
  return (MEDIA_SIZES as readonly unknown[]).includes(value);
}

export function isMediaAlign(value: unknown): value is MediaAlign {
  return (MEDIA_ALIGNS as readonly unknown[]).includes(value);
}

/**
 * 노드의 크기. 이미지는 고르지 않았으면 `null`(올린 원본 크기, 본문 폭 안)이다. 영상에는 원본
 * 크기가 없으므로 기본 크기를 쓴다. 모르는 값도 고르지 않은 것으로 본다.
 */
export function mediaSize(node: WikiNode): MediaSize | null {
  const value = stringAttr(node, "size");
  if (isMediaSize(value)) return value;
  return node.type === NODE.youtube ? DEFAULT_VIDEO_SIZE : null;
}

/** 노드의 정렬. 고르지 않았거나 모르는 값이면 왼쪽이다(이 기능 전의 이미지와 같다). */
export function mediaAlign(node: WikiNode): MediaAlign {
  const value = stringAttr(node, "align");
  return isMediaAlign(value) ? value : "left";
}
