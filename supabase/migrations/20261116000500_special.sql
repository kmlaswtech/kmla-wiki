-- 특수 기능: 작성이 필요한 문서, 고립된 문서, 모든 문서.
--
-- 셋 다 호출자 권한(security invoker)으로 돈다. 표의 RLS가 그대로 적용되어, 회원 확인이 없으면
-- 빈 결과가 나오고 삭제된 문서는 관리자에게만 보인다. 그래도 목록에서는 삭제된 문서를 뺀다.

-- 링크는 걸려 있는데 아직 없는 문서. 많이 가리켜진 순.
--
-- page_refs에는 제목 키(소문자)만 있어 영문 제목은 소문자로 나온다. 한글 제목은 그대로다.
create function public.wanted_pages(p_limit integer default 100)
returns table (title_key text, ref_count integer)
language sql stable set search_path = ''
as $$
  select ref.target_key, count(*)::integer
  from public.page_refs as ref
  join public.pages as source on source.id = ref.from_page_id
  where ref.kind = 'link'
    and source.deleted_at is null
    and not exists (
      select 1 from public.pages as target
      where target.title_key = ref.target_key and target.deleted_at is null
    )
  group by ref.target_key
  order by count(*) desc, ref.target_key
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

-- 어느 문서도 링크하지 않고 넘겨주지도 않는 일반 문서. 찾아올 길이 검색뿐인 문서다.
-- 하위 문서는 상위 문서 화면의 "하위 문서" 목록에서 찾아갈 수 있으므로 상위가 있으면 뺀다.
create function public.orphan_pages(p_after text default null, p_limit integer default 100)
returns table (title text)
language sql stable set search_path = ''
as $$
  select page.title
  from public.pages as page
  where page.namespace = 'main'
    and page.redirect_key is null
    and page.deleted_at is null
    and (p_after is null or page.title_key > lower(p_after))
    and not exists (
      select 1 from public.pages as parent
      where parent.title_key = page.parent_key and parent.deleted_at is null
    )
    and not exists (
      select 1
      from public.page_refs as ref
      join public.pages as source on source.id = ref.from_page_id
      where ref.kind = 'link' and ref.target_key = page.title_key
        and source.id <> page.id and source.deleted_at is null
    )
    and not exists (
      select 1 from public.pages as redirect
      where redirect.redirect_key = page.title_key and redirect.deleted_at is null
    )
  order by page.title_key
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

-- 모든 문서를 가나다순으로. 넘겨주기 문서는 뺀다. `p_after`(제목) 다음부터 이어 읽는다.
create function public.list_all_pages(
  p_namespace text default 'main',
  p_after text default null,
  p_limit integer default 100
)
returns table (title text)
language sql stable set search_path = ''
as $$
  select page.title
  from public.pages as page
  where page.namespace = p_namespace
    and page.redirect_key is null
    and page.deleted_at is null
    and (p_after is null or page.title_key > lower(p_after))
  order by page.title_key
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

revoke all on function public.wanted_pages(integer) from public, anon;
revoke all on function public.orphan_pages(text, integer) from public, anon;
revoke all on function public.list_all_pages(text, text, integer) from public, anon;

grant execute on function public.wanted_pages(integer) to authenticated;
grant execute on function public.orphan_pages(text, integer) to authenticated;
grant execute on function public.list_all_pages(text, text, integer) to authenticated;
