# CI, 배포, 브랜치

이 문서는 개요다. 워크플로 동작은 `.github/workflows/`가, 브랜치 보호는 GitHub ruleset이 정본이다.
둘이 다르면 정본을 믿고 이 문서를 고친다.

## 브랜치

`dev`가 기본 브랜치이고 `main`은 `dev`를 묶어 올리는 곳이다. `main`이 운영, `dev`가
미리보기(`wiki-dev.kmla.online`)다. merge하면 바로 배포된다.

- `dev` 대상 PR은 squash merge만 된다(ruleset). squash 커밋 제목이 PR 제목이 된다.
- `dev`에 직접 push는 저장소 admin만 할 수 있다(ruleset 우회). 그때는 squash되지 않고 커밋이
  그대로 들어간다.
- `main`에는 `dev` → `main` PR로만 들어가고, merge commit으로 merge한다(ruleset). 직접 push는
  막혀 있다.
- `main`과 `dev`는 삭제와 force push가 막혀 있다. merge된 작업 브랜치는 자동으로 지워진다.

## CI

`.github/workflows/ci.yml`이 PR에서 돌고(Markdown이나 `docs/`만 바뀐 경우는 건너뛴다), `main`·`dev`
push에서는 배포 워크플로가 `workflow_call`로 먼저 부른다.

- `app` job: `pnpm format:check`, `pnpm verify`.
- `migrations` job(PR만): base 브랜치에 있는 migration을 고치거나 지우지 않았는지, 새 migration
  버전이 base의 마지막 버전보다 큰지 검사한다(`scripts/check-migration-order.mjs`).
- `db` job: 로컬 Supabase를 한 번 띄운 뒤 pgTAP, DB lint, 보안 advisor, schemas·migrations drift
  검사, 생성 타입 diff 검사, chromium E2E를 차례로 돌린다.

CI는 merge를 막지 않고 결과만 알린다.

## 그 밖의 워크플로

- `branch-policy.yml`: `main` 대상 PR이 이 저장소의 `dev`에서 왔는지 검사한다(`source-branch`).
  `main` ruleset이 이 검사를 필수로 건다.
- `keepalive.yml`: 매일 위키 dev·prod Supabase의 `public.keepalive()`를 publishable key로 불러
  무료 프로젝트가 일시 정지되지 않게 한다. 주소와 key는 공개 값이라 워크플로에 그대로 적는다. 실패는
  경고만 남긴다.
- `docs.yml`: Markdown·`docs/`만 바뀐 PR에서 `ci.yml` 대신 돈다. 각 `AGENTS.md`가 200줄 이하인지, 각 `CLAUDE.md`가 `@AGENTS.md` 한 줄인지 검사하고 `pnpm format:check`를 돌린다.
- `release-tag.yml`: `main`에 들어온 커밋에 KST 날짜 태그(`v2026.11.17`, 같은 날 두 번째부터
  `.2`)를 붙인다.

## 배포

KMLA Online 저장소와 같은 구조다. 배포는 GitHub Actions에서만 한다. Vercel 프로젝트는 GitHub에
연결돼 있지만 `vercel.json`이 Git 자동 배포를 꺼 두었다.

| 브랜치 | 워크플로         | Supabase                          | Vercel                          |
| ------ | ---------------- | --------------------------------- | ------------------------------- |
| `dev`  | `deploy-dev.yml` | 위키 dev(`ipwbtdcrrkklqjesftnq`)  | Preview, `wiki-dev.kmla.online` |
| `main` | `release.yml`    | 위키 prod(`ubzhxqmmyvwmwinuxntb`) | Production, `wiki.kmla.online`  |

- 순서: CI → 최신 커밋인지 확인 → 사전 점검(`supabase link`, `db push --dry-run`, 함수 목록,
  Vercel) → 최신 커밋인지 다시 확인 → `supabase db push` → `supabase functions deploy` → Vercel 배포
  (`scripts/release/vercel.mjs`). DB가 화면보다 먼저 나간다. 워크플로는 Supabase 프로젝트 ID가
  위 표와 다르면 배포를 거부한다.
- 비밀 값은 GitHub Environment `Development`(`dev`만)와 `Production`(`main`만)에 같은 이름으로 둔다.
  `SUPABASE_ACCESS_TOKEN`은 그 프로젝트 하나로 범위를 좁힌 토큰이다.
- 배포되는 것은 migration과 함수 코드뿐이다. 원격 Auth 설정(Site URL, 로그인 수단, `custom:kmla`
  제공자)과 Edge Function 비밀 값은 각 프로젝트 대시보드에서 손으로 맞춘다.
- `VITE_*` 값은 Vercel 프로젝트 환경 변수(Production, Preview)에 둔다.
