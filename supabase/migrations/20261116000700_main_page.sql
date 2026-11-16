-- 위키:대문 문서의 처음 판. 첫 화면(`/`)이 이 문서를 보여 준다.
--
-- 위키:편집 도움말(20261116000600)과 같은 방식으로 넣는다. 회원이 쓴 판이 아니라서 작성자 기록은
-- 남기지 않고 이름은 "관리자"로 둔다. 대문은 운영 시 관리자 보호를 건다(계획서). 처음부터 보호된
-- 상태로 만들기 때문에 관리 기록에는 남지 않는다. 이미 같은 제목의 문서가 있으면 건드리지 않는다.
--
-- 운영 DB에는 seed의 예시 문서가 없으므로, 아직 없는 문서로 가는 링크는 넣지 않는다.
do $$
declare
  v_title constant text := '위키:대문';
  v_body constant text := $body$큼온 위키에 온 것을 환영합니다. 학교 안에 있어야만 알 수 있는 것을 함께 적는 곳입니다.

## 처음이라면

- [[위키:편집 도움말]]에서 쓰는 법과 지켜야 할 것을 먼저 읽어 주세요.
- 찾는 문서가 없으면 위의 검색창에 제목을 넣어 바로 만들 수 있습니다.
- 틀려도 괜찮습니다. 다른 사람이 고치고, 모든 판은 기록에 남아 언제든 되돌릴 수 있습니다.

## 둘러보기

- 머리띠의 **최근 변경**에서 방금 고쳐진 문서를 봅니다.
- **특수 기능**의 "작성이 필요한 문서"에는 링크는 걸려 있지만 아직 아무도 쓰지 않은 문서가 모여 있습니다. 여기서부터 채워 주세요.$body$;
  v_page_id bigint;
  v_revision_id bigint;
begin
  if exists (select 1 from public.pages where title_key = lower(v_title)) then
    return;
  end if;

  insert into public.pages (title, protection) values (v_title, 'admin')
  returning id into v_page_id;

  insert into public.revisions (
    page_id, parent_revision_id, body, summary, author_pseudonym, kind, byte_size, byte_delta
  )
  values (
    v_page_id, null, v_body, '처음 판', '관리자', 'edit',
    octet_length(v_body), octet_length(v_body)
  )
  returning id into v_revision_id;

  update public.pages set current_revision_id = v_revision_id where id = v_page_id;

  insert into public.page_refs (from_page_id, kind, target_key)
  select distinct v_page_id, ref.kind, lower(ref.target)
  from private.extract_refs(v_body) as ref
  where ref.kind <> 'redirect';
end;
$$;
