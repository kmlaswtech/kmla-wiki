-- 제목 자동완성(머리띠 검색창, 편집기의 `[[`·`틀:`·`분류:`).
--
-- 앱은 한글 조합 중인 마지막 글자를 넓힌 정규식(`p_pattern`)을 만들어 보낸다. "가"를 치면 `가`~`깋`
-- 전체가 맞으므로, 그냥 가나다순으로 자르면 정확히 맞는 문서가 목록에서 밀려난다. 그래서 글자
-- 그대로(`p_query`) 맞는 정도로 순서를 매긴다: 정확히 → 앞부분 → 포함 → 넓혀서만 맞음.
--
-- 이름공간 접두어(`틀:`)는 정규식이 아니라 글자 그대로 거른다. 패턴은 접두어 뒤 부분에 맞춘다.
-- 호출자 권한으로 돌아 표의 RLS가 그대로 적용된다.
create function public.suggest_titles(
  p_query text,
  p_pattern text,
  p_prefix text default '',
  p_limit integer default 8
)
returns table (title text)
language sql stable set search_path = ''
as $$
  select page.title
  from (select coalesce(p_prefix, '') as prefix) as arg
  cross join public.pages as page
  -- 접두어 뒤 부분. 걸러 내기와 순위 모두 이것을 본다.
  cross join lateral (select substr(page.title_key, length(arg.prefix) + 1) as rest) as key
  where page.deleted_at is null
    and starts_with(page.title_key, arg.prefix)
    and key.rest ~ coalesce(p_pattern, '')
  -- false가 먼저 온다: 정확히 → 앞부분 → 포함 → 넓혀서만 맞음.
  order by
    key.rest <> p_query,
    not starts_with(key.rest, p_query),
    strpos(key.rest, p_query) = 0,
    page.title_key
  limit least(greatest(coalesce(p_limit, 8), 1), 8);
$$;

revoke all on function public.suggest_titles(text, text, text, integer) from public, anon;
grant execute on function public.suggest_titles(text, text, text, integer) to authenticated;
