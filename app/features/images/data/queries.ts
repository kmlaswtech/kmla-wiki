import { getSupabase } from "~/shared/supabase/client";
import { unwrap } from "~/shared/supabase/errors";

export interface ImageInfo {
  path: string;
  width: number;
  height: number;
}

interface RawImage extends ImageInfo {
  id: string;
}

/**
 * 본문에 쓰인 이미지의 경로와 크기. 키는 이미지 id.
 *
 * 크기를 미리 알면 이미지가 뜨기 전에 자리를 잡아 둘 수 있어 글이 밀리지 않는다.
 * 지워졌거나 등록되지 않은 이미지는 결과에 없다.
 */
export async function resolveImages(
  body: string,
): Promise<ReadonlyMap<string, ImageInfo>> {
  // 이미지가 없는 문서가 대부분이다. 요청을 아낀다.
  if (!body.includes("](img:")) return new Map();

  const rows = unwrap(
    await getSupabase().rpc("resolve_images", { p_body: body }),
  ) as unknown as RawImage[];
  return new Map(rows.map(({ id, ...info }) => [id, info]));
}
