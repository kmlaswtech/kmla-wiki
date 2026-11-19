/**
 * `supabase/schemas/`와 `supabase/migrations/`가 같은 스키마를 만드는지 검사한다.
 *
 * `supabase db schema declarative sync --no-apply`는 차이가 있어도 0으로 끝나고 차이를
 * migration 파일로 써 둔다. 그래서 이 스크립트가 그 파일을 읽어 출력하고 지운 뒤 실패로
 * 돌려준다. 차이가 없으면 CLI가 파일을 쓰지 않는다.
 *
 * 비교는 CLI가 띄우는 shadow DB에서 한다. 로컬 DB는 건드리지 않는다.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrations = path.join(root, "supabase", "migrations");
const name = "drift_check";

// 작업 사본의 migration이 CRLF면 함수 본문에 `\r`이 들어가 함수마다 차이로 나온다. 저장소에는
// LF로 들어 있으니(`.gitattributes`) 비교하기 전에 알려 준다.
const crlf = execFileSync(
  "git",
  ["ls-files", "--eol", "--", "supabase/migrations/"],
  { cwd: root, encoding: "utf8" },
)
  .split("\n")
  .filter((line) => /\bw\/crlf\b/.test(line))
  .map((line) => line.split("\t").pop());
if (crlf.length > 0) {
  console.error(
    `작업 사본의 migration이 CRLF라 비교할 수 없습니다. 파일을 지우고 \`git checkout -- <파일>\`로 다시 받으세요.\n${crlf.join("\n")}`,
  );
  process.exit(1);
}

const before = new Set(await readdir(migrations));
// CLI 인자는 `package.json`의 `db:diff` 한 곳에 두고 그 명령을 그대로 실행한다. `pnpm db:drift`로
// 실행하면 `node_modules/.bin`이 PATH에 있다. `pnpm` 실행 파일을 다시 찾지 않으므로 corepack으로
// 실행해도 된다. 인자가 전부 상수라 셸 문자열 하나로 넘긴다(Windows에서 `.cmd` 실행에 셸이 필요하다).
const { scripts } = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const result = spawnSync(`${scripts["db:diff"]} ${name}`, {
  cwd: root,
  encoding: "utf8",
  shell: true,
});
const created = (await readdir(migrations)).filter(
  (file) => !before.has(file) && file.endsWith(`_${name}.sql`),
);
// 실패한 실행도 반쯤 쓴 파일을 남길 수 있다. 무엇이든 읽어 둔 뒤 먼저 지운다.
const drafts = [];
for (const file of created) {
  const target = path.join(migrations, file);
  drafts.push(await readFile(target, "utf8"));
  await rm(target);
}

if (result.status !== 0) {
  process.stderr.write(result.stdout + result.stderr);
  process.exit(result.status ?? 1);
}

if (drafts.length === 0) {
  console.log("supabase/schemas와 migrations가 같은 스키마를 만듭니다.");
  process.exit(0);
}

console.error("supabase/schemas와 migrations가 어긋났습니다. 차이:\n");
for (const draft of drafts) console.error(draft);
console.error(
  "schemas를 먼저 고쳤다면 `pnpm db:diff <이름>`으로 migration을 만드세요.",
);
process.exit(1);
