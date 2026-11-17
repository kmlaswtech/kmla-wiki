import { extractRefs, type WikiDoc } from "~/features/markup";
import { getSupabase } from "~/shared/supabase/client";
import type { Json } from "~/shared/supabase/database.types";
import { unwrap } from "~/shared/supabase/errors";

export interface ImageInfo {
  path: string;
  width: number;
  height: number;
}

/** `resolve_images`(그리고 `get_page_view`의 `images`)가 돌려주는 한 줄. */
export interface RawImage extends ImageInfo {
  id: string;
}

/** RPC 결과를 이미지 id로 찾는 표로 바꾼다. */
export function toImageMap(
  rows: readonly RawImage[],
): ReadonlyMap<string, ImageInfo> {
  return new Map(rows.map(({ id, ...info }) => [id, info]));
}

/**
 * 본문에 쓰인 이미지의 경로와 크기. 키는 이미지 id.
 *
 * 크기를 미리 알면 이미지가 뜨기 전에 자리를 잡아 둘 수 있어 글이 밀리지 않는다.
 * 지워졌거나 등록되지 않은 이미지는 결과에 없다.
 */
export async function resolveImages(
  body: WikiDoc,
): Promise<ReadonlyMap<string, ImageInfo>> {
  // 이미지가 없는 문서가 대부분이다. 요청을 아낀다.
  if (!extractRefs(body).some((ref) => ref.kind === "image")) return new Map();

  const rows = unwrap(
    await getSupabase().rpc("resolve_images", {
      p_body: body as unknown as Json,
    }),
  ) as unknown as RawImage[];
  return toImageMap(rows);
}
