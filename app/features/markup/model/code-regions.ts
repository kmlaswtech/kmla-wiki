/**
 * 코드 블록과 인라인 코드 안의 위키 문법은 글자일 뿐이다. 문법을 다루는 모든 단계가 이 파일의
 * 함수로 코드 영역을 건너뛴다. DB의 `private.extract_refs`도 같은 영역을 지운 뒤 뽑는다.
 */

interface Region {
  code: boolean;
  text: string;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

/** 본문을 "코드 블록"과 "그 밖"으로 나눈다. 줄 단위다. */
export function splitFencedCode(source: string): Region[] {
  const regions: Region[] = [];
  const lines = source.split("\n");
  let buffer: string[] = [];
  let fence: string | null = null;

  const flush = (code: boolean) => {
    if (buffer.length === 0) return;
    regions.push({ code, text: buffer.join("\n") });
    buffer = [];
  };

  for (const line of lines) {
    if (fence === null) {
      const open = FENCE_OPEN.exec(line);
      if (open) {
        flush(false);
        fence = open[1]!;
      }
      buffer.push(line);
      continue;
    }

    buffer.push(line);
    const close = FENCE_OPEN.exec(line);
    if (
      close &&
      close[1]![0] === fence[0] &&
      close[1]!.length >= fence.length &&
      line.trim() === close[1]
    ) {
      flush(true);
      fence = null;
    }
  }

  // 닫히지 않은 코드 블록은 문서 끝까지 코드다.
  flush(fence !== null);
  return regions;
}

const INLINE_CODE = /`[^`\n]+`/g;
// 사설 영역 문자. 본문에 나올 일이 없어 자리표시로 쓴다.
const STASH_OPEN = "";
const STASH_CLOSE = "";
const STASHED = /(\d+)/g;

/**
 * 코드가 아닌 부분에만 `transform`을 적용한다.
 *
 * 인라인 코드는 자리표시로 바꿔 두었다가 되돌린다. `transform`은 여러 줄에 걸친 문법(틀의 값)도
 * 볼 수 있도록 코드 블록 사이의 덩어리를 통째로 받는다.
 */
export function transformOutsideCode(
  source: string,
  transform: (text: string) => string,
): string {
  return splitFencedCode(source)
    .map((region) => {
      if (region.code) return region.text;

      const stash: string[] = [];
      const stashed = region.text.replace(INLINE_CODE, (code) => {
        stash.push(code);
        return `${STASH_OPEN}${stash.length - 1}${STASH_CLOSE}`;
      });
      return transform(stashed).replace(
        STASHED,
        (_, index: string) => stash[Number(index)] ?? "",
      );
    })
    .join("\n");
}

/** 코드 영역을 지운 본문. 문법을 "찾기만" 할 때 쓴다. */
export function stripCode(source: string): string {
  return splitFencedCode(source)
    .filter((region) => !region.code)
    .map((region) => region.text.replace(INLINE_CODE, ""))
    .join("\n");
}
