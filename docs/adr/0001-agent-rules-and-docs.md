# 규칙은 AGENTS.md에, 이유는 ADR·주석에 둔다

**상태**: 채택 · **날짜**: 2026-11-19

규칙, 이유, 동작 설명이 모두 `CLAUDE.md` 한 파일에 섞여 있었고, Claude Code 말고 다른 agent는 이
파일을 읽지 않았다. 그래서 규칙의 정본을 `AGENTS.md`로 옮기고(`CLAUDE.md`는 `@AGENTS.md` 한 줄),
동작 설명은 `docs/architecture/`에, 여러 곳에 걸친 결정의 이유는 ADR에 둔다. 기록 위치와 ADR
기준은 KMLA Online 저장소의 ADR 안내를 따라 [README](README.md)에 정했다. 두 저장소를 오가는
사람이 같은 방식으로 읽고 쓰게 하기 위해서다.

## 검토한 대안

- **`CLAUDE.md`와 `AGENTS.md`를 따로 관리**: 같은 규칙이 두 곳에 생기고 한쪽이 낡는다.
  `docs.yml`이 `CLAUDE.md`가 `@AGENTS.md` 한 줄인지 검사한다.
- **ADR 없이 `AGENTS.md`에 이유까지 쓰기**: 파일이 계속 커지고, 대체된 결정의 이유가 함께
  지워진다. `docs.yml`이 `AGENTS.md`를 200줄 이하로 막는다.
