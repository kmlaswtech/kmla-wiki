import { compressImage, getImageDimensions } from "~/shared/lib/image/compress";
import { randomUUID } from "~/shared/lib/random-uuid";
import { getSupabase } from "~/shared/supabase/client";
import { unwrap } from "~/shared/supabase/errors";

const BUCKET = "wiki-images";
/** 받아 둔 이미지를 두는 Cache Storage의 이름. 로그아웃할 때 통째로 지운다. */
const CACHE_NAME = "wiki-images-v1";

export interface UploadedImage {
  id: string;
  /** 본문에 넣을 문법. */
  markdown: string;
}

/**
 * 이미지 한 장을 올린다: 변환 → 업로드 → 등록. 세 단계가 한 동작이다.
 *
 * 변환은 압축이기 전에 보장이다. 다시 인코딩하면서 EXIF(촬영 위치 포함)가 사라지고, 형식이
 * WebP 하나로 맞춰진다. 원본을 그대로 올리는 경로는 없다.
 *
 * 경로에는 사용자 정보를 넣지 않는다. 연도는 정리할 때 훑기 쉽게 하려는 것뿐이다.
 *
 * @throws 변환·업로드·등록 가운데 하나라도 실패하면 던진다. 메시지는 사용자에게 보여도 된다.
 */
export async function uploadImage(file: File): Promise<UploadedImage> {
  const webp = await compressImage(file, "article").catch((error: unknown) => {
    // 1MB를 넘는 드문 사진은 한 단계 줄여 다시 시도한다.
    if (error instanceof Error && error.message.includes("용량 제한")) {
      return compressImage(file, "articleCompact");
    }
    throw error;
  });
  const [width, height] = await getImageDimensions(webp);

  const id = randomUUID();
  const path = `${new Date().getFullYear()}/${id}.webp`;
  const supabase = getSupabase();

  const { error } = await supabase.storage.from(BUCKET).upload(path, webp, {
    contentType: "image/webp",
    // 경로가 uuid라 내용이 바뀌지 않는다.
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw new Error("이미지를 올리지 못했습니다.", { cause: error });

  unwrap(
    await supabase.rpc("register_image", {
      p_image_id: id,
      p_width: width,
      p_height: height,
    }),
  );

  const alt = file.name.replace(/\.[^./\\]+$/, "").replace(/[[\]\n]/g, " ");
  return { id, markdown: `![${alt}](img:${id})` };
}

/**
 * 이미지 본문을 받아 `blob:` 주소로 돌려준다. 쓴 뒤에는 `URL.revokeObjectURL`로 놓아 준다.
 *
 * 비공개 버킷이라 `<img src>`로 바로 받을 수 없다. 서명 주소는 발급할 때마다 달라져 브라우저
 * 캐시가 듣지 않으므로, 인증 요청으로 받아 Cache Storage에 경로를 키로 넣어 둔다. 경로가
 * uuid라 내용이 바뀌지 않아 만료가 필요 없고, 기기마다 이미지 한 장을 한 번만 내려받는다
 * (Free 플랜의 전송량 한도를 지키는 장치다).
 */
export async function loadImageUrl(path: string): Promise<string> {
  const cache = await openCache();
  const key = `/${BUCKET}/${path}`;

  const cached = await cache?.match(key);
  if (cached) return URL.createObjectURL(await cached.blob());

  const { data, error } = await getSupabase()
    .storage.from(BUCKET)
    .download(path);
  if (error) throw new Error("이미지를 불러오지 못했습니다.", { cause: error });

  // 캐시에 넣지 못해도(용량 부족 등) 이번에는 그린다.
  await cache
    ?.put(
      key,
      new Response(data, { headers: { "Content-Type": "image/webp" } }),
    )
    .catch(() => undefined);
  return URL.createObjectURL(data);
}

async function openCache(): Promise<Cache | null> {
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    // 사생활 보호 모드 등에서는 Cache Storage가 없다. 캐시 없이 매번 받는다.
    return null;
  }
}

/** 로그아웃할 때 이 브라우저에 받아 둔 이미지를 지운다. */
export async function clearImageCache(): Promise<void> {
  try {
    await caches.delete(CACHE_NAME);
  } catch {
    // 지울 캐시가 없다.
  }
}
