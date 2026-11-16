/**
 * 치는 중인 검색어로 제목 후보를 찾는 정규식.
 *
 * 한글 입력기는 마지막 글자를 조합하는 중이라, "신성"을 치는 동안 입력칸은 `신 → 신ㅅ → 신서 →
 * 신성`으로 바뀐다. 검색어를 글자 그대로 찾으면 `신ㅅ`, `신서`는 "신성"에 맞지 않는다. 그래서
 * 마지막 글자만은 "앞으로 이렇게 될 수 있는 모든 글자"로 넓혀 찾는다.
 *
 * - `서` → 받침이 붙은 `석`·`선`·`성`… (`[서-섷]`)
 * - `고` → 모음이 겹친 `과`·`괘`·`괴`도
 * - `신` → `신` 그대로, 받침이 겹친 `싢`·`싡`, 받침이 다음 글자로 넘어간 `시` + ㄴ으로 시작하는 글자
 * - `신ㅅ` → `신` + ㅅ으로 시작하는 글자
 *
 * 다 친 글자도 일부러 넓힌다. 입력기마다 조합이 끝났는지 알리는 방식이 달라 믿을 수 없고, 편집기
 * 자동완성도 같은 함수를 쓴다. 그 대신 글자 그대로 맞는 것을 앞에 두는 순위는 DB(`suggest_titles`)가
 * 매긴다.
 *
 * 결과는 PostgreSQL 정규식(ARE)이다. 앞뒤를 묶지 않으므로 제목 어디에 있어도 맞는다. 검색어는
 * `searchKey`로 맞춰 넘긴다(NFC가 아니면 낱자로 풀린 글자를 음절로 보지 못한다).
 */
export function titleMatchPattern(query: string): string {
  const chars = [...query];
  const last = chars.pop();
  if (last === undefined) return "";
  return escapeRegex(chars.join("")) + lastCharPattern(last);
}

/** 정규식에서 뜻이 있는 글자를 글자 그대로 찾도록 막는다. */
function escapeRegex(text: string): string {
  return text.replace(/[\\^$.|?*+()[\]{}]/g, "\\$&");
}

const SYLLABLE_FIRST = 0xac00;
const SYLLABLE_LAST = 0xd7a3;
const VOWEL_COUNT = 21;
const FINAL_COUNT = 28;

/** 첫소리 19개. 호환 자모(입력기가 낱자로 보여 주는 글자) 순서가 첫소리 번호와 같다. */
const INITIALS = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
/** 받침 27개. 0번 자리(공백)는 받침 없음. `FINALS.indexOf("")`도 0이다. */
const FINALS = " ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ";

/** 겹모음: ㅗ(8) → ㅘ·ㅙ·ㅚ, ㅜ(13) → ㅝ·ㅞ·ㅟ, ㅡ(18) → ㅢ. */
const VOWEL_EXTENSIONS: Record<number, number[]> = {
  8: [9, 10, 11],
  13: [14, 15, 16],
  18: [19],
};

/**
 * 겹받침과 그 두 자음. 받침 하나(앞 자음)에 뒤 자음을 더 치면 겹받침이 되고, 겹받침 뒤에 모음을
 * 치면 뒤 자음이 다음 글자 첫소리로 넘어간다.
 */
const DOUBLE_FINALS: Record<string, [string, string]> = {
  ㄳ: ["ㄱ", "ㅅ"],
  ㄵ: ["ㄴ", "ㅈ"],
  ㄶ: ["ㄴ", "ㅎ"],
  ㄺ: ["ㄹ", "ㄱ"],
  ㄻ: ["ㄹ", "ㅁ"],
  ㄼ: ["ㄹ", "ㅂ"],
  ㄽ: ["ㄹ", "ㅅ"],
  ㄾ: ["ㄹ", "ㅌ"],
  ㄿ: ["ㄹ", "ㅍ"],
  ㅀ: ["ㄹ", "ㅎ"],
  ㅄ: ["ㅂ", "ㅅ"],
};

function syllable(initial: number, vowel: number, final: number): string {
  return String.fromCharCode(
    SYLLABLE_FIRST + (initial * VOWEL_COUNT + vowel) * FINAL_COUNT + final,
  );
}

/** 첫소리가 같은 글자 가운데 가운뎃소리 `vowel`(없으면 전부)인 것, 받침은 무엇이든. */
function syllableRange(initial: number, vowel?: number): string {
  const from = syllable(initial, vowel ?? 0, 0);
  const to = syllable(initial, vowel ?? VOWEL_COUNT - 1, FINAL_COUNT - 1);
  return `[${from}-${to}]`;
}

function lastCharPattern(char: string): string {
  const alternatives = new Set<string>([escapeRegex(char)]);

  // 낱자 자음: 그 자음으로 시작하는 글자가 될 것이다.
  const initial = INITIALS.indexOf(char);
  if (initial >= 0) alternatives.add(syllableRange(initial));

  const code = char.charCodeAt(0);
  if (code >= SYLLABLE_FIRST && code <= SYLLABLE_LAST) {
    const offset = code - SYLLABLE_FIRST;
    const syllableInitial = Math.floor(offset / (VOWEL_COUNT * FINAL_COUNT));
    const vowel = Math.floor(offset / FINAL_COUNT) % VOWEL_COUNT;
    const final = offset % FINAL_COUNT;

    if (final === 0) {
      // 받침이 붙거나 모음이 겹칠 수 있다.
      alternatives.add(syllableRange(syllableInitial, vowel));
      for (const extended of VOWEL_EXTENSIONS[vowel] ?? []) {
        alternatives.add(syllableRange(syllableInitial, extended));
      }
    } else {
      const finalLetter = FINALS[final]!;
      // 받침이 겹받침이 될 수 있다.
      for (const [double, [first]] of Object.entries(DOUBLE_FINALS)) {
        if (first === finalLetter) {
          alternatives.add(
            syllable(syllableInitial, vowel, FINALS.indexOf(double)),
          );
        }
      }
      // 받침(겹받침이면 뒤 자음)이 다음 글자 첫소리로 넘어갈 수 있다.
      const [rest, moved] = DOUBLE_FINALS[finalLetter] ?? ["", finalLetter];
      const movedInitial = INITIALS.indexOf(moved);
      if (movedInitial >= 0) {
        alternatives.add(
          syllable(syllableInitial, vowel, FINALS.indexOf(rest)) +
            syllableRange(movedInitial),
        );
      }
    }
  }

  return alternatives.size === 1
    ? [...alternatives][0]!
    : `(?:${[...alternatives].join("|")})`;
}
