# 큼온 위키 저장소 안내

민족사관고등학교 학교생활 위키. React Router 8 프레임워크 모드의 SPA(`ssr: false`)와
Supabase로 만든다. 런타임 앱 서버는 없다. 컴퓨터, 패드, 모바일 환경을 전부 고려한다.

대화 및 기록은 ASD-STE100를 70% 이상 지키며, 한국어로 한다.

## 이 문서에 쓰는 것

이 파일은 모든 agent(Claude Code, Codex 등)가 읽는 규칙의 정본이다. `CLAUDE.md`는 이 파일을
불러오기만 한다. 줄을 더하기 전에 아래를 확인한다.

- 이 줄이 없으면 agent가 틀리게 하는가? 코드, 설정, 오류 메시지로 알 수 있는 것은 쓰지 않는다.
- 도구로 막을 수 있는가? lint, 테스트, CI, DB 제약으로 막을 수 있으면 그렇게 하고, 여기에는
  쓰지 않거나 한 줄만 남긴다.
- 규칙인가? 동작 설명은 `docs/architecture/`에, 결정 이유와 버린 안은 `docs/adr/`에 두고 여기에는
  링크만 둔다.
- 한 폴더에서만 필요한가? 그 폴더의 `AGENTS.md`(예: `supabase/AGENTS.md`)에 둔다.
- `AGENTS.md`는 200줄을 넘기지 않는다(`docs.yml`이 검사). 넘으면 더하기 전에 낡은 줄을
  지우거나 옮긴다.
- 규칙의 이유가 없어지면(도구가 바뀜, 기능이 없어짐) 그 규칙도 지운다.

## 실행 환경

- 패키지 매니저는 pnpm이다(`package.json`의 `packageManager`). PATH에 `pnpm`이 없을 수 있으므로 이
  문서의 `pnpm …`은 `corepack pnpm …`으로 실행한다. Node 버전은 `.nvmrc`를 따른다.
- 로컬 Supabase(Docker)를 쓴다. `pnpm db:start` 뒤 `.env.example`을 `.env.local`로 복사하고,
  `pnpm exec supabase status -o env`의 `API_URL`, `PUBLISHABLE_KEY`로 채운다.
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
  - `data/`: Supabase I/O. 파일은 하는 일로 나눈다(조회 `queries.ts`, 쓰기 `mutations.ts`,
    Storage `files.ts`, 인증 `session.ts` 등).
  - `model/`: 순수 로직.
  - `index.ts`: 공개 API. 다른 feature는 이 파일로만 가져다 쓴다.
- `app/shared/`는 도메인을 모른다. `ui/`(shadcn), `components/`, `hooks/`, `lib/`(범용 유틸),
  `supabase/`(클라이언트와 생성 타입)가 있다. Supabase 클라이언트는 `getSupabase()`로 꺼낸다.
  브라우저 전용이라 `clientLoader`/`clientAction`, 이벤트 핸들러, effect에서만 부른다.
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
- Edge Function 비밀 값은 `supabase/functions/.env`(커밋하지 않음)에 둔다. 항목은
  `supabase/functions/.env.example`이 정본이다.

## 로그인 (큼온으로 로그인)

흐름과 각 부분의 역할은 `docs/architecture/login.md`에 있다.

- 위키 계정은 KMLA 계정 하나에 하나다. 운영에서는 `custom:kmla` 말고 다른 로그인 수단을 모두 끈다.
- KMLA 토큰이나 refresh token을 저장하거나 회원 확인 말고 다른 곳에 쓰지 않는다.
- `kmla-verify`는 확인이 끝나면 그 토큰의 KMLA 세션을 끊는다(`logout?scope=local`). 이 단계를
  지우지 않는다. KMLA 토큰은 KMLA Auth API(이메일 조회, 비밀번호 변경)에서 그 사용자로 동작하기
  때문이다.
- `kmla-verify`의 판정은 `handler.ts`(Deno API 없음, Vitest가 시험)에, 연결은 `index.ts`에 둔다.
- custom provider는 `config.toml`로 설정할 수 없다. 로컬은 `pnpm kmla:provider`(admin API)로
  등록하고, `pnpm db:reset` 뒤에 다시 실행한다.
- 개발용 이메일 로그인(seed 계정)은 로컬 `config.toml`과 `VITE_DEV_LOGIN=1`에서만 쓴다. E2E도 이
  로그인을 쓴다.

## 데이터베이스와 보안

- 클라이언트의 검증과 권한 확인은 UX일 뿐이다. 권한, 소유권, 상태 전이, 여러 행에 걸친 불변식은
  Postgres(grant, RLS, 제약, 트리거, 트랜잭션 RPC)가 강제한다.
- 기본 권한을 막아 두었다(`supabase/schemas/10-foundation.sql`). 새 테이블과 함수는 필요한 역할에만
  명시적으로 grant한다. 브라우저가 쓰는 테이블은 grant와 RLS를 테이블과 같은 schemas 파일에 둔다.
  그러면 같은 migration으로 나간다.
- anon이 부를 수 있는 것은 `public.keepalive()`(`select true`) 하나뿐이다. `keepalive.yml`이 무료
  프로젝트 일시 정지를 막으려고 일부러 열어 두었다. 권한을 정리할 때 지우지 않는다. 다른 것은
  anon에게 열지 않는다(`privileges.test.sql`이 검사한다).
- `security definer` 함수는 안에서 호출자를 확인하고, `set search_path = ''`를 두고, 필요한
  역할에만 EXECUTE를 준다.
- 실명 같은 숨길 정보는 클라이언트 grant가 없는 `private` 스키마에 둔다.
- 스키마를 바꾼 뒤에는 `pnpm db:types`로 `app/shared/supabase/database.types.ts`를 다시 만든다.
  이 파일은 손으로 고치지 않는다. CI가 낡은 타입을 잡는다.
- DB 동작 테스트는 `supabase/tests/*.test.sql`(pgTAP)에 둔다. 공통 계정과 준비 작업은
  `helpers.inc`에 있다.
- `supabase/seed.sql`은 개발 전용이다. seed 계정은 `<이름>@wiki.test`, 비밀번호 `password123`이다.
  `alice`·`bob`(회원), `admin`(관리자), `expired`(회원 확인 만료), `outsider`(회원 행 없음). E2E가
  개발용 로그인 폼으로 쓴다.
- DDL은 `supabase/schemas/`가 정본이다. DB 작업 전에 `supabase/AGENTS.md`를 읽는다.

## 테스트

- Vitest 테스트는 `test/`에 둔다. `app/` 아래 파일은 `app/`을 뺀 같은 경로다
  (`app/features/markup/model/parse.ts` → `test/features/markup/model/….test.ts`). Edge Function은
  `test/supabase/functions/<함수>.test.ts`다. Vitest API는 명시적으로 import한다(`globals: false`).
- node와 jsdom 환경은 경로로 나뉜다(`vitest.config.ts`). `model/`, `shared/lib/`,
  `supabase/functions/`의 `.ts` 테스트는 node에서 돈다. DOM이 필요하면 `.tsx`로 만든다.
- Playwright E2E는 `e2e/`에 있고 로컬 Supabase와 seed가 필요하다. 로컬에서는 dev 서버를,
  `CI=1`에서는 프로덕션 빌드를 `vite preview`로 띄운다.
- E2E는 로컬에서 돌리지 않고 CI 결과로 확인한다. 단, `e2e/`의 테스트를 고쳤을 때는 고친 파일을
  로컬에서 돌린다.
- E2E는 깨지면 위키를 쓸 수 없게 되는 핵심 흐름(로그인, 읽기, 편집·저장, 검색 등)만 지킨다. 기능을
  더할 때마다 E2E를 덧붙이지 않는다. 세부 동작은 Vitest나 pgTAP로 확인하고, 화면 변경으로 기존
  E2E가 깨지면 그 부분만 고친다.

## 검증

| 변경             | 실행할 것                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| 소스 편집 중     | `pnpm typecheck`, `pnpm lint`, 관련 Vitest 파일(`pnpm exec vitest run <file>`)                             |
| 소스 변경 마무리 | `pnpm verify`(typegen, oxlint, tsc, Vitest, build)                                                         |
| DB 변경          | `pnpm db:reset` → `pnpm test:db` → `pnpm db:lint` → `pnpm db:advisors` → `pnpm db:types` → `pnpm db:drift` |
| 화면 흐름 변경   | 로컬 E2E는 돌리지 않고 CI 결과를 본다                                                                      |
| E2E 테스트 수정  | 고친 E2E 파일(`pnpm e2e <file>`)                                                                           |
| 문서·설정만      | 바뀐 파일에 Prettier                                                                                       |

- 실행한 검사와 건너뛴 검사를 구분해 보고한다.
- 포맷은 바뀐 파일에 적용한다(`pnpm exec prettier --write <files>`). CI가
  `pnpm format:check`로 저장소 전체를 검사한다. Markdown과 `docs/`만 바뀐 PR에서는 `ci.yml` 대신
  `docs.yml`이 검사한다.
- Supabase CLI 명령은 Windows에서 하나씩 순서대로 실행한다.

## 브랜치, PR, 배포

CI·배포 워크플로와 브랜치 ruleset은 `docs/architecture/delivery.md`에 있다.

- `dev`가 기본 브랜치다. 작업 브랜치는 `dev`에서 따고, PR과 push는 `dev`로 한다. `main`에 직접
  커밋하거나 작업 브랜치 PR을 `main`으로 열지 않는다. 급한 수정도 `dev`를 거친다.
- merge하면 바로 배포된다(`dev` → `wiki-dev.kmla.online`, `main` → `wiki.kmla.online`). 배포는
  GitHub Actions에서만 한다.
- PR 제목은 영어로 짧게 쓴다. squash 커밋 제목이 된다(예: `Fold sections on tap`). PR 본문은
  한국어로 쓴다.
- 원격 Auth 설정과 Edge Function 비밀 값은 배포되지 않는다. 각 프로젝트 대시보드에서 손으로
  맞춘다.
- 공개 리포다. 워크플로에 비밀 값을 쓰는 job을 더할 때는 fork PR에서 실행되지 않게 한다
  (`pull_request_target`으로 PR 코드를 실행하지 않는다).

## 커밋

- 커밋 메시지는 한국어 한 문장으로, 무엇을 하는지 "…한다" 꼴로 쓴다.
- 줄 끝은 LF다(`.gitattributes`, `.editorconfig`).

## 문서

| 종류           | 위치                            | 쓰는 것                     |
| -------------- | ------------------------------- | --------------------------- |
| 규칙           | `AGENTS.md`, 폴더의 `AGENTS.md` | 지금 지킬 것                |
| 결정 기록(ADR) | `docs/adr/`                     | 왜 그렇게 정했나, 버린 안   |
| 설명           | `docs/architecture/`            | 복잡한 로직이 동작하는 방식 |

- 결정 이유는 범위에 맞는 곳에 쓴다. 한 코드에만 해당하면 그 코드의 주석에, 여러 곳에 걸치면
  ADR에 쓴다. ADR은 `docs/adr/README.md`의 세 기준을 모두 채우고 사용자가 승인할 때만 더한다.
- 작업과 관련된 ADR만 읽는다. 상태가 `채택`이 아닌 ADR은 지금 유효하지 않다.
- 설명 문서가 다루는 코드를 바꾸면 같은 PR에서 그 문서도 고친다. 문서와 코드가 다르면 코드를
  믿고, 문서를 고친다.

## Skill

- 프로젝트 skill은 `.agents/skills/`에 있고 `skills add`로 설치한다. `pnpm install`이
  `scripts/link-skills.mjs`로 git에 없는 `.claude/skills/`에 링크한다. 설치할 것이 없어 install이
  건너뛰면 링크도 안 생기므로, skill을 더한 뒤에는 `pnpm run prepare`를 돌린다.
- 설치한 skill(`skills-lock.json`에 있음)은 고치지 않는다. 고치면 `computedHash`가 깨지고 업데이트
  때 사라진다. skill을 더하거나 빼는 것은 사용자가 정한다.
- skill이 이 문서와 다르면 이 문서를 따르고 차이를 보고한다. Next.js 전용 API나 런타임 앱 서버가
  필요한 권장은 이 SPA에 적용하지 않는다.
