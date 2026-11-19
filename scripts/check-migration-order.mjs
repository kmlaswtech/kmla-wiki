/**
 * PR이 바꾸는 migration을 base 브랜치와 비교한다. `.github/workflows/ci.yml`의 `migrations`
 * job이 PR merge commit의 첫 부모(base)와 merge commit을 넘긴다.
 *
 *   node scripts/check-migration-order.mjs <base-ref> [<head-ref>]
 *
 * base 브랜치의 migration은 이미 그 브랜치의 원격 DB(`dev` → dev, `main` → prod)에 배포된
 * 것으로 본다. 그래서 다음을 거부한다.
 *
 * - base의 가장 큰 버전보다 작거나 같은 새 migration. `db push`는 원격 이력보다 앞선 버전을
 *   `--include-all` 없이 거부하고, 넣더라도 로컬과 다른 순서로 적용된다.
 * - base에 있는 migration의 수정, 삭제, 이름 변경.
 * - 이름이 `<14자리 버전>_<snake_case>.sql`이 아닌 새 파일과 버전이 겹치는 새 migration.
 */
import { execFileSync } from "node:child_process";

const DIRECTORY = "supabase/migrations";
const NAME = /^(\d{14})_[a-z0-9_]+\.sql$/;

/** ref의 migration 파일 이름 → git object id. */
function migrations(ref) {
  const listing = execFileSync(
    "git",
    ["ls-tree", "-r", "-z", ref, "--", `${DIRECTORY}/`],
    { encoding: "utf8" },
  );
  const files = new Map();
  for (const entry of listing.split("\0")) {
    if (!entry) continue;
    const [meta, file] = entry.split("\t");
    files.set(file.slice(DIRECTORY.length + 1), meta.split(" ")[2]);
  }
  return files;
}

/** 버전과 파일 이름은 같은 길이의 숫자로 시작하므로 문자열 순서가 곧 적용 순서다. */
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function version(name) {
  return NAME.exec(name)?.[1];
}

function problems(base, head) {
  const found = [];
  const report = (name, message) => found.push({ name, message });

  for (const [name, object] of base) {
    if (!head.has(name)) {
      report(
        name,
        "base 브랜치에 있는 migration이라 지우거나 이름을 바꿀 수 없습니다.",
      );
    } else if (head.get(name) !== object) {
      report(name, "base 브랜치에 있는 migration이라 고칠 수 없습니다.");
    }
  }

  const latest = [...base.keys()]
    .map(version)
    .filter(Boolean)
    .sort(byText)
    .at(-1);
  // base 버전과 겹치는 새 버전은 `latest` 비교에서 이미 걸리므로 새 파일끼리만 본다.
  const versions = new Map();

  for (const name of [...head.keys()]
    .filter((n) => !base.has(n))
    .sort(byText)) {
    const current = version(name);
    if (!current) {
      report(name, "이름은 `<14자리 버전>_<snake_case>.sql`이어야 합니다.");
      continue;
    }
    if (latest && current <= latest) {
      report(
        name,
        `base 브랜치의 마지막 migration(${latest})보다 버전이 커야 합니다. rebase한 뒤 \`pnpm db:diff\`로 다시 만들거나 이름을 바꾸세요.`,
      );
    }
    if (versions.has(current)) {
      report(name, `${versions.get(current)}와 버전(${current})이 겹칩니다.`);
    }
    versions.set(current, name);
  }
  return found;
}

const [baseRef, headRef = "HEAD"] = process.argv.slice(2);
if (!baseRef) {
  console.error(
    "Usage: node scripts/check-migration-order.mjs <base-ref> [<head-ref>]",
  );
  process.exitCode = 2;
} else {
  const found = problems(migrations(baseRef), migrations(headRef));
  for (const { name, message } of found) {
    const file = `${DIRECTORY}/${name}`;
    console.error(
      process.env.GITHUB_ACTIONS === "true"
        ? `::error file=${file}::${file} ${message}`
        : `${file} ${message}`,
    );
  }
  if (found.length > 0) process.exitCode = 1;
}
