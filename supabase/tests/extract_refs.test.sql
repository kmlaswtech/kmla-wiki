-- 본문에서 링크·분류·틀·이미지·넘겨주기를 뽑는 규칙.
--
-- 화면 렌더러와 같은 사례 표를 쓴다. 여기를 고치면 `test/features/markup/model/ref-cases.ts`도
-- 같이 고친다.
begin;
\ir helpers.inc
select * from no_plan();

create function pg_temp.refs(p_body text) returns text
language sql
as $$
  select coalesce(string_agg(ref.kind || '=' || ref.target, ' ' order by ref.kind, ref.target), '')
  from private.extract_refs(p_body) as ref;
$$;

select is(pg_temp.refs('그냥 글'), '', 'plain text has no references');
select is(pg_temp.refs('[[신성]]'), 'link=신성', 'a link');
select is(pg_temp.refs('[[덕고관/엘리베이터|중베]]'), 'link=덕고관/엘리베이터', 'a link with a label');
select is(pg_temp.refs('[[귀가#신청 방법]]'), 'link=귀가', 'a link to a section');
select is(pg_temp.refs('[[귀가#신청|여기]]'), 'link=귀가', 'a link to a section with a label');
select is(pg_temp.refs('[[#문단]]'), '', 'a same-page section link is not a reference');
select is(pg_temp.refs('[[ 정기_귀가 ]]'), 'link=정기 귀가', 'link targets are normalized like titles');
select is(pg_temp.refs('[[신성]] 그리고 [[신성]]'), 'link=신성 link=신성', 'duplicates are left to the caller');
select is(pg_temp.refs('[[분류:생활]]'), 'category=분류:생활', 'a category');
select is(pg_temp.refs('[[:분류:생활]]'), 'link=분류:생활', 'a leading colon links to a category without joining it');
select is(pg_temp.refs('{{틀:오래된 정보}}'), 'template=틀:오래된 정보', 'a template');
select is(pg_temp.refs('{{틀:상위 문서|외출·외박}}'), 'template=틀:상위 문서', 'a template with a value');
select is(pg_temp.refs('{{{1}}}'), '', 'a template parameter is not a template');
select is(pg_temp.refs('{{오래된 정보}}'), '', 'a template needs the 틀: prefix');
select is(
  pg_temp.refs('![지도](img:0b9f4c1e-8a57-4c8f-9b0a-1f2e3d4c5b6a)'),
  'image=0b9f4c1e-8a57-4c8f-9b0a-1f2e3d4c5b6a', 'an uploaded image');
select is(pg_temp.refs('![외부](https://example.com/a.png)'), '', 'an external image is not a reference');
select is(pg_temp.refs('#넘겨주기 [[PRISM]]'), 'link=PRISM redirect=PRISM', 'a redirect');
select is(pg_temp.refs(E'\n  #넘겨주기 [[PRISM]]'), 'link=PRISM redirect=PRISM', 'a redirect after blank space');
select is(pg_temp.refs(E'글\n#넘겨주기 [[PRISM]]'), 'link=PRISM', 'a redirect must be the first thing in the body');
select is(pg_temp.refs('`[[코드]]` 와 [[진짜]]'), 'link=진짜', 'inline code is not parsed');
select is(
  pg_temp.refs(E'```\n[[코드]]\n{{틀:코드}}\n```\n[[진짜]]'), 'link=진짜',
  'a fenced code block is not parsed');
select is(pg_temp.refs('[[나쁜<제목>]]'), '', 'an invalid title is not a reference');
select is(
  pg_temp.refs(E'| 이름 | 뜻 |\n| --- | --- |\n| [[덕고관/엘리베이터|중베]] | 가운데 |'),
  'link=덕고관/엘리베이터', 'a labelled link inside a table');

select * from finish();
rollback;
