# 0001. 규칙은 AGENTS.md에, 이유는 ADR에, 동작 설명은 architecture 문서에 둔다

- 상태: 받아들임
- 날짜: 2026-11-19

## 배경

규칙, 이유, 동작 설명이 모두 `CLAUDE.md` 한 파일(190줄)에 있었다. 문제는 세 가지였다.

- 여러 명이 여러 agent(Claude Code, Codex 등)로 작업한다. `CLAUDE.md`는 Claude Code만 읽는다.
- 복잡한 로직(로그인, 배포)의 설명이 규칙 사이에 섞여 있어서 둘 다 찾기 어렵다.
- 규칙 파일은 줄이 더해지기만 하고 지워지지 않는다. agent는 낡은 규칙을 그대로 따른다.

## 고려한 안

1. `CLAUDE.md` 하나에 계속 쓴다: 쉽지만 다른 agent가 읽지 않고, 파일이 계속 커진다.
2. `AGENTS.md`와 `CLAUDE.md`를 따로 관리한다: 같은 규칙이 두 곳에 생기고 한쪽이 낡는다.
3. `AGENTS.md`를 정본으로 두고 `CLAUDE.md`는 `@AGENTS.md`로 불러온다. 이유와 설명은 `docs/`로
   나눈다.
4. RFC 절차나 Log4brains 같은 문서 도구를 쓴다: 지금 팀 규모에는 과하다. PR 리뷰로 충분하다.

## 결정

3안을 고른다.

- 규칙: `AGENTS.md`와 폴더의 `AGENTS.md`(`supabase/AGENTS.md`). 각 `CLAUDE.md`는
  `@AGENTS.md` 한 줄이다.
- 결정 이유: `docs/adr/NNNN-slug.md`. 형식은 MADR 짧은 형식을 한국어로 줄인 `template.md`다.
  받아들인 ADR은 고치지 않는다.
- 동작 설명: `docs/architecture/<주제>.md`. 코드와 함께 고친다.

`AGENTS.md`가 커지지 않게 첫 절("이 문서에 쓰는 것")에 넣을 기준과 200줄 한도를 둔다. 도구로
막을 수 있는 규칙은 도구로 옮긴다.

## 결과

- `CLAUDE.md`의 로그인 흐름은 `docs/architecture/login.md`로, CI·배포·브랜치 설명은
  `docs/architecture/delivery.md`로 옮겼다. `AGENTS.md`에는 규칙과 링크만 남겼다.
- Markdown과 `docs/`만 바뀐 PR은 CI가 건너뛴다. 문서 PR은 로컬 Prettier가 유일한 검사다.
- PR 템플릿에서 문서 갱신을 확인한다. 줄 수 한도는 `agents-size.yml` 워크플로가 검사한다.
- 다시 검토할 조건: `AGENTS.md`가 한도를 자주 넘거나, ADR이 1년 넘게 더해지지 않을 때.
