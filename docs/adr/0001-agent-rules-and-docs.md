# 0001. 규칙은 AGENTS.md에, 이유는 ADR에, 동작 설명은 architecture 문서에 둔다

날짜: 2026-11-19

## 배경

규칙, 이유, 동작 설명이 모두 `CLAUDE.md` 한 파일(190줄)에 있었다. 문제는 세 가지였다.

- 여러 명이 여러 agent(Claude Code, Codex 등)로 작업한다. `CLAUDE.md`는 Claude Code만 읽는다.
- 복잡한 로직(로그인, 배포)의 설명이 규칙 사이에 섞여 있어서 둘 다 찾기 어렵다.
- 규칙 파일은 줄이 더해지기만 하고 지워지지 않는다. agent는 낡은 규칙을 그대로 따른다.

학교 위키라 맡는 사람이 졸업과 함께 바뀐다. 다음 사람에게 "왜"를 남길 곳도 필요하다.

## 고려한 안

1. `CLAUDE.md` 하나에 계속 쓴다: 쉽지만 다른 agent가 읽지 않고, 파일이 계속 커진다.
2. `AGENTS.md`와 `CLAUDE.md`를 따로 관리한다: 같은 규칙이 두 곳에 생기고 한쪽이 낡는다.
3. `AGENTS.md`를 정본으로 두고 `CLAUDE.md`는 `@AGENTS.md`로 불러온다. 이유와 설명은 `docs/`로
   나눈다.
4. 3안에 ADR 목록 파일, 상태 관리, RFC 절차, Log4brains 같은 도구를 더한다: 사람이 손으로 맞출
   것이 늘고 결국 낡는다. 지금 팀 규모에는 과하다.

## 결정

3안을 고른다. 손으로 유지할 것은 최소로 둔다.

- 규칙: `AGENTS.md`와 폴더의 `AGENTS.md`(`supabase/AGENTS.md`). 각 `CLAUDE.md`는
  `@AGENTS.md` 한 줄이다.
- 결정 이유: `docs/adr/NNNN-slug.md`. 목록 파일과 상태 필드는 두지 않는다. 결정을 바꾸면 새
  ADR을 쓰고 옛 ADR에 "대체됨" 한 줄만 더한다.
- 동작 설명: `docs/architecture/<주제>.md`. 코드와 함께 고친다.

`AGENTS.md`가 커지지 않게 첫 절("이 문서에 쓰는 것")에 넣을 기준을 둔다. 도구로 막을 수 있는
규칙은 도구로 옮긴다. 글로만 둔 기준은 지켜지지 않으므로, 검사할 수 있는 것은 `docs.yml`이
검사한다.

## 결과

- `CLAUDE.md`의 로그인 흐름은 `docs/architecture/login.md`로, CI·배포·브랜치 설명은
  `docs/architecture/delivery.md`로 옮겼다. 보안에 필요한 규칙은 이유와 함께 `AGENTS.md`에 남겼다.
- `docs.yml`이 Markdown·`docs/`만 바뀐 PR을 검사한다. 각 `AGENTS.md`는 200줄 이하, 각
  `CLAUDE.md`는 `@AGENTS.md` 한 줄, 저장소 전체 Prettier.
- PR 템플릿에서 ADR과 문서를 고쳤는지 "고침 / 해당 없음"으로 적는다.
- 남은 일: 의존 방향(`routes → features → shared`)을 lint 규칙으로 옮긴다. 이미 내린 큰 결정(서버
  없는 SPA, RLS 우선 보안, 선언형 스키마, KMLA OIDC 로그인)의 ADR을 쓴다.
- 다시 검토할 조건: `AGENTS.md`가 한도를 자주 넘거나, 1년 넘게 ADR이 더해지지 않을 때.
