# 스키마와 migration

`supabase/schemas/*.sql`(선언적 스키마, pg-delta)이 DDL의 정본이고, `supabase/migrations/`는
배포 이력이다. 테이블, 컬럼, 제약, 인덱스, 함수, RLS 정책, grant를 바꿀 때는 schemas를 먼저
고치고 migration은 거기서 만든다. Studio, SQL editor, 손으로 쓴 migration에서만 DDL을 바꾸지
않는다.

## 흐름

1. `supabase/schemas/`의 해당 도메인 파일을 고친다.
2. `pnpm db:diff <snake_case_이름>`으로 migration 초안 `migrations/<버전>_<이름>.sql`을 만든다
   (`supabase db schema declarative sync --no-apply`). Docker의 shadow DB에서 migrations와 schemas를
   비교해 차이만 쓰고, 로컬 DB에는 적용하지 않는다. 차이가 없으면 파일을 만들지 않는다.
   `supabase db diff`는 schemas를 읽지 않으므로 쓰지 않는다.
3. 초안 전체를 읽고 아래 검토 목록대로 고친다. DML이 필요하면 DDL 뒤에 의존 순서대로 덧붙인다.
4. 루트 AGENTS.md "검증"의 DB 변경 단계를 돌린다. 마지막 `pnpm db:drift`가 schemas와
   migrations가 같은 스키마를 만드는지 본다.

## 파일 구성

| 파일               | 내용                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| `10-foundation`    | 스키마, 기본 권한, 회원·차단 테이블, 회원 확인 RPC, 권한 도우미(`can_read` 등), `keepalive`              |
| `20-pages`         | 문서·판·가명·참조 테이블, 제목·본문(doc) 도우미, 읽기·저장·이동·되돌리기·검색 RPC                        |
| `30-redirects`     | 넘겨주기 본문 규칙과 점검(`redirect_issues`)                                                             |
| `40-admin`         | 관리자, 차단, 보호, 삭제·복구, 판 숨김, 같은 사람 편집 조회·일괄 되돌리기, 관리 기록                     |
| `50-images`        | 이미지 테이블과 RPC, `storage.objects` 정책                                                              |
| `60-special`       | 특수 문서 목록(전체·고립·필요한·짧은·긴 문서), 제목 추천                                                 |
| `70-reports`       | 회원의 신고(판·토론 글), 판 신고 RPC와 관리자의 판 신고 목록·닫기, 대상이 숨겨지면 닫는 트리거           |
| `80-discussions`   | 문서별 토론과 글, 열기·글·닫기·다시 열기·거두기, 관리자의 글 숨김·토론 삭제, 읽기·최근 토론 RPC, 글 신고 |
| `90-notifications` | 즐겨찾기(별표)와 알림(즐겨찾기한 문서의 편집·새 토론, 내가 쓴 토론의 새 글), 마지막으로 본 시각          |

- 객체마다 최종 정의 하나만 둔다. 과거 migration의 `alter`/`drop` 순서를 옮겨 쓰지 않는다.
- 새 도메인은 의존하는 파일보다 뒤 번호로 만든다.
- 파일은 하나씩 통째로 적용된다. pg-delta는 실패한 파일을 다시 시도할 뿐 파일 안의 순서는 고치지
  않는다. 그래서 파일 안에서는 시그니처에 테이블 타입이 없는 함수(생성 컬럼·정책이 부르는 도우미)
  → 테이블(참조되는 쪽 먼저) → 테이블 타입을 쓰는 함수 순서로 둔다. 뒤 파일의 테이블을 가리키는
  외래 키는 그 뒤 파일 끝에 `ALTER TABLE … ADD CONSTRAINT`로 둔다. 파일끼리 서로를 기다리면
  `shadow load stuck`으로 실패한다.
- pg-delta가 쓰는 꼴을 따르고 grant 줄을 임의로 정리하지 않는다. 설계 의도는 객체 바로 위 `--`
  주석으로 남긴다.

## migration에만 두는 것

diff가 만들지 못하거나 믿을 수 없는 것은 `supabase migration new <이름>`으로 따로 쓰고 따로
검토한다.

- migration이 직접 실행하는 DML: 문서 시드(`help_page`, `main_page`), 백필, 정리. 함수 본문 안의
  DML은 선언적 정의에 그대로 둔다.
- `storage.buckets` 같은 설정 테이블의 행(`wiki-images` 버킷은 images migration에 있다).
- 확장. Supabase가 기본으로 까는 확장(`pgcrypto` 등)은 선언하지 않는다. seed가 쓰는
  `extensions.crypt`도 그 확장이다.
- Auth·Storage·Realtime 서비스 설정. 로컬은 `config.toml`, 원격은 대시보드다.

## migration 검토 목록

- `drop table`/`drop column`/`drop type`, 파괴적인 형 변환, 새 `not null`이 의도한 것이고 필요한
  데이터 이전이 있는가.
- `drop function`과 바뀐 시그니처(인자 이름·형·기본값, `returns table` 열)가 의도한 것인가. 다시
  만든 함수에 `security definer`/`invoker`, 변동성, `search_path = ''`, `revoke`/`grant execute`가
  그대로 있는가.
- PUBLIC, anon, authenticated가 의도하지 않은 함수·테이블 권한을 얻지 않는가. anon은
  `keepalive()`만 부를 수 있다.
- RLS가 켜져 있고 정책의 `to`, `using`, `with check`가 맞는가. 컬럼 단위 grant가 빠지거나
  바뀌지 않았는가.
- 인덱스 조건과 표현식, 백필·제약·인덱스·정책의 문장 순서, 데이터가 있는 테이블에서의 잠금과
  비용.
- 같은 뜻의 check 제약을 지우고 다시 만드는 초안이면 schemas의 표현을 기존 migration과 같은 꼴로
  되돌리고 다시 만든다.

## 주의

- 원격에 배포된 migration은 고치지 않고 새 migration을 더한다. 새 버전은 마지막 버전보다 커야
  한다(CI `migrations` job이 검사). CLI는 현재 UTC 시각을 버전으로 쓰므로, 기존 버전이 시계보다
  앞서 있으면 파일 이름을 마지막 버전 뒤로 고친다.
- 스키마 단위 기본 권한은 전역 기본값(함수 EXECUTE를 PUBLIC에)을 뺄 수 없다. `private` 함수에도
  `REVOKE ALL ... FROM PUBLIC`을 함수마다 둔다.
- Supabase CLI는 정확한 버전으로 고정한다(`db:diff`·`db:drift`가 pg-delta 출력에 기댄다). 올릴
  때는 `pnpm db:drift`를 다시 확인한다.
- `db:diff`·`db:drift`는 Docker가 떠 있어야 한다. 로컬 Supabase 스택은 꺼져 있어도 된다.
