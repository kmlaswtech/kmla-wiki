# 큼온 위키 저장소 안내

민족사관고등학교 학교생활 위키. React Router 8 프레임워크 모드의 SPA(`ssr: false`)와
Supabase로 만든다. 런타임 앱 서버는 없다.

## 실행 환경

- 패키지 매니저는 pnpm이다(`package.json`의 `packageManager`). 명령은 `corepack pnpm …`으로 실행한다.
  Node 버전은 `.nvmrc`를 따른다.
- 로컬 Supabase(Docker)를 쓴다. `pnpm db:start` 뒤 `npx supabase status -o env`의 값으로
  `.env.example`을 `.env.local`에 복사해 채운다.
- 개발 서버 포트는 5183이다(`vite.config.ts`, `strictPort`).
- 로컬 Docker DB는 일회용이다. 초기화, 재시드, 컨테이너 재시작을 확인 없이 해도 된다.
- 원격 Supabase 프로젝트에는 사용자 요청 없이 push·배포하지 않는다.

## 코드 구조

- 의존 방향은 `routes → features → shared`다. feature는 routes를 import하지 않고, shared는
  features·routes를 import하지 않는다.
- `app/routes/`는 얇게 둔다. 화면 조립과 `clientLoader`/`clientAction`만 두고, Supabase를 직접
  import하지 않는다.
- `app/features/<feature>/`가 제품 코드를 가진다.
  - `components/`: UI.
  - `data/`: Supabase I/O. 조회는 `queries.ts`, 쓰기는 `mutations.ts`, Storage는 `files.ts`.
  - `model/`: 순수 로직.
  - `index.ts`: 공개 API. 다른 feature는 이 파일로만 가져다 쓴다.
- `app/shared/`는 도메인을 모른다. 범용 유틸은 `shared/lib/`에 둔다.
- 라우트 I/O는 `clientLoader`/`clientAction`으로 한다. 서버 `loader`/`action`은 쓰지 않는다.
- 빌드할 때 루트 라우트를 한 번 렌더한다. 그래서 `app/root.tsx`와 그 import 그래프에서 렌더
  중에 `window`, `document`, `localStorage`, Supabase 클라이언트를 건드리지 않는다.
- 주소 체계는 `app/routes.ts`가 정본이다. 문서 동작은 동작을 앞에 둔다(`/edit/제목`). 제목에
  `/`가 들어갈 수 있기 때문이다.

## UI

- `app/shared/ui/`는 shadcn(`base-vega`, Base UI) 기반의 유지보수 코드다. registry로 덮어쓰거나
  일괄 재생성하지 않는다. 새 컴포넌트는 없는 것만 추가한다.
- Radix가 아니라 Base UI다. 링크 버튼 같은 합성에는 `asChild`가 아니라 `render`를 쓴다.

## 환경 변수

- `VITE_*` 값은 번들에 들어가 공개된다. 비밀 키나 `service_role` 키를 두지 않는다.
- 새 `VITE_*`를 추가하면 `.env.example`과 `app/shared/lib/env.ts`를 함께 고친다.

## 데이터베이스와 보안

- 클라이언트의 검증과 권한 확인은 UX일 뿐이다. 권한, 소유권, 상태 전이, 여러 행에 걸친 불변식은
  Postgres(grant, RLS, 제약, 트리거, 트랜잭션 RPC)가 강제한다.
- 기본 권한을 막아 두었다(foundation migration). 새 테이블과 함수는 필요한 역할에만 명시적으로
  grant한다. 브라우저가 쓰는 테이블은 grant와 RLS를 같은 migration에 둔다.
- `security definer` 함수는 안에서 호출자를 확인하고, `set search_path = ''`를 두고, 필요한
  역할에만 EXECUTE를 준다.
- 실명 같은 숨길 정보는 클라이언트 grant가 없는 `private` 스키마에 둔다.
- migration은 `supabase/migrations/<14자리 버전>_<snake_case>.sql`이다. 원격에 배포된
  migration은 고치지 않고 새 migration을 더한다.
- 스키마를 바꾼 뒤에는 `pnpm db:types`로 `app/shared/supabase/database.types.ts`를 다시 만든다.
  이 파일은 손으로 고치지 않는다. CI가 낡은 타입을 잡는다.
- DB 동작 테스트는 `supabase/tests/*.test.sql`(pgTAP)에 둔다. 공통 계정과 준비 작업은
  `helpers.inc`에 있다.
- `supabase/seed.sql`은 개발 전용이다. seed 계정(`alice`, `bob`, `admin` 등 `@wiki.test`)은
  E2E가 개발용 로그인 폼으로 쓴다.

## 테스트

- Vitest 테스트는 `test/`에 `app/`과 같은 경로로 둔다. Vitest API는 명시적으로 import한다
  (`globals: false`).
- node와 jsdom 환경은 경로로 나뉜다(`vitest.config.ts`). `model/`과 `shared/lib/`의 `.ts`
  테스트는 node에서 돈다. DOM이 필요하면 `.tsx`로 만든다.
- Playwright E2E는 `e2e/`에 있고 로컬 Supabase와 seed가 필요하다. 로컬에서는 dev 서버를,
  `CI=1`에서는 프로덕션 빌드를 `vite preview`로 띄운다.

## 검증

| 변경             | 실행할 것                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------- |
| 소스 편집 중     | `pnpm typecheck`, `pnpm lint`, 관련 Vitest 파일(`pnpm exec vitest run <file>`)           |
| 소스 변경 마무리 | `pnpm verify`(typegen, oxlint, tsc, Vitest, build)                                       |
| DB 변경          | `pnpm db:reset` → `pnpm test:db` → `pnpm db:lint` → `pnpm db:advisors` → `pnpm db:types` |
| 화면 흐름 변경   | 관련 E2E 파일(`pnpm e2e <file>`)                                                         |
| 문서·설정만      | 바뀐 파일에 Prettier                                                                     |

- 실행한 검사와 건너뛴 검사를 구분해 보고한다.
- 포맷은 바뀐 파일에 적용한다(`pnpm exec prettier --write <files>`). CI가
  `pnpm format:check`로 저장소 전체를 검사한다.
- Supabase CLI 명령은 Windows에서 하나씩 순서대로 실행한다.

## CI

`.github/workflows/ci.yml`이 `main`·`dev` push와 PR에서 돈다(Markdown만 바뀐 경우는 건너뛴다).

- `app` job: `pnpm format:check`, `pnpm verify`.
- `db` job: 로컬 Supabase를 한 번 띄운 뒤 pgTAP, DB lint, 보안 advisor, 생성 타입 diff 검사,
  chromium E2E를 차례로 돌린다.

CI는 merge를 막지 않고 결과만 알린다. 그 밖의 워크플로:

- `branch-policy.yml`: `main` 대상 PR이 이 저장소의 `dev`에서 왔는지 검사한다(`source-branch`).
  `main` ruleset이 이 검사를 필수로 건다.
- `release-tag.yml`: `main`에 들어온 커밋에 KST 날짜 태그(`v2026.11.17`, 같은 날 두 번째부터
  `.2`)를 붙인다.

공개 리포다. 워크플로에 비밀 값을 쓰는 job을 더할 때는 fork PR에서 실행되지 않게 한다
(`pull_request_target`으로 PR 코드를 실행하지 않는다).

## 브랜치

`dev`가 기본 브랜치이고 `main`은 `dev`를 묶어 올리는 곳이다. 배포가 생기면 `main`이 운영,
`dev`가 미리보기다.

- 작업 브랜치는 `dev`에서 따고, PR과 push는 `dev`로 한다. `main`에 직접 커밋하거나 작업 브랜치
  PR을 `main`으로 열지 않는다.
- `dev` 대상 PR은 squash merge만 된다(ruleset). squash 커밋 제목이 PR 제목이므로, PR 제목도
  커밋 메시지 규칙을 따른다.
- `dev`에 직접 push는 저장소 admin만 할 수 있다(ruleset 우회). 그때는 squash되지 않고 커밋이
  그대로 들어간다.
- `main`에는 `dev` → `main` PR로만 들어가고, merge commit으로 merge한다(ruleset). 직접 push는
  막혀 있다. 급한 수정도 `dev`를 거친다.
- `main`과 `dev`는 삭제와 force push가 막혀 있다. merge된 작업 브랜치는 자동으로 지워진다.

## 커밋

- 커밋 메시지는 한국어 한 문장으로, 무엇을 하는지 "…한다" 꼴로 쓴다.
- 줄 끝은 LF다(`.gitattributes`, `.editorconfig`).
