-- 본문에서 링크·분류·틀·이미지·넘겨주기를 뽑는 규칙.
--
-- 화면과 같은 사례 표를 같은 JSON으로 쓴다. 여기를 고치면 `test/features/markup/model/ref-cases.ts`도
-- 같이 고친다.
begin;
\ir helpers.inc
select * from no_plan();

create function pg_temp.refs(p_body text) returns text
language sql
as $$
  select coalesce(string_agg(ref.kind || '=' || ref.target, ' ' order by ref.kind, ref.target), '')
  from private.extract_refs(p_body::jsonb) as ref;
$$;

select is(
  pg_temp.refs('{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"그냥 글"}]}]}'),
  '', 'plain text');
select is(
  pg_temp.refs('{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"신성","marks":[{"type":"wikiLink","attrs":{"target":"신성","section":""}}]}]}]}'),
  'link=신성', 'a link');
select is(
  pg_temp.refs('{"type":"doc","content":[{"type":"paragraph","content":[{"type":"footnote","content":[{"type":"text","text":"출처","marks":[{"type":"wikiLink","attrs":{"target":"학사 규정","section":""}}]}]}]}]}'),
  'link=학사 규정', 'a link inside a footnote');
select is(
  pg_temp.refs('{"type":"doc","content":[{"type":"youtube","attrs":{"videoId":"dQw4w9WgXcQ"},"content":[{"type":"caption","content":[{"type":"text","text":"본관","marks":[{"type":"wikiLink","attrs":{"target":"본관","section":""}}]}]}]}]}'),
  'link=본관', 'a link inside a media caption');
select is(
  pg_temp.refs('{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"중베","marks":[{"type":"wikiLink","attrs":{"target":"덕고관/엘리베이터","section":""}}]}]}]}'),
  'link=덕고관/엘리베이터', 'a link with a label');
select is(
  pg_temp.refs('{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"귀가","marks":[{"type":"wikiLink","attrs":{"target":"귀가","section":"신청 방법"}}]}]}]}'),
  'link=귀가', 'a link to a section');
select is(
  pg_temp.refs('{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"문단","marks":[{"type":"wikiLink","attrs":{"target":"","section":"문단"}}]}]}]}'),
  '', 'a same-page section link');
select is(
  pg_temp.refs('{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":" 정기_귀가 ","marks":[{"type":"wikiLink","attrs":{"target":" 정기_귀가 ","section":""}}]}]}]}'),
  'link=정기 귀가', 'a normalized link target');
select is(
  pg_temp.refs('{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"신성","marks":[{"type":"wikiLink","attrs":{"target":"신성","section":""}}]},{"type":"text","text":" 그리고 "},{"type":"text","text":"신성","marks":[{"type":"wikiLink","attrs":{"target":"신성","section":""}}]}]}]}'),
  'link=신성 link=신성', 'duplicates');
select is(
  pg_temp.refs('{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"나쁜<제목>","marks":[{"type":"wikiLink","attrs":{"target":"나쁜<제목>","section":""}}]}]}]}'),
  '', 'an invalid title');
select is(
  pg_temp.refs('{"type":"doc","content":[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"가","marks":[{"type":"wikiLink","attrs":{"target":"가","section":""}}]}]}]}]},{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"나","marks":[{"type":"wikiLink","attrs":{"target":"나","section":""}}]}]}]},{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"ㄷ","marks":[{"type":"wikiLink","attrs":{"target":"다","section":""}}]}]}]}]}]}]}'),
  'link=가 link=나 link=다', 'a link nested in a list, quote and table');
select is(
  pg_temp.refs('{"type":"doc","content":[{"type":"fold","attrs":{"title":"더 보기"},"content":[{"type":"paragraph","content":[{"type":"text","text":"신성","marks":[{"type":"wikiLink","attrs":{"target":"신성","section":""}}]}]}]}]}'),
  'link=신성', 'a link inside a fold');
select is(
  pg_temp.refs('{"type":"doc","content":[],"attrs":{"categories":["분류:생활","기숙사"]}}'),
  'category=분류:기숙사 category=분류:생활', 'categories');
select is(
  pg_temp.refs('{"type":"doc","content":[],"attrs":{"categories":["나쁜<분류>",""]}}'),
  '', 'an invalid category');
select is(
  pg_temp.refs('{"type":"doc","content":[{"type":"template","attrs":{"name":"틀:오래된 정보","args":[]}}]}'),
  'template=틀:오래된 정보', 'a template');
select is(
  pg_temp.refs('{"type":"doc","content":[{"type":"template","attrs":{"name":"상위 문서","args":["외출·외박"]}}]}'),
  'template=틀:상위 문서', 'a template without the prefix');
select is(
  pg_temp.refs('{"type":"doc","content":[{"type":"paragraph","content":[{"type":"templateParam","attrs":{"index":1}}]}]}'),
  '', 'a template parameter');
select is(
  pg_temp.refs('{"type":"doc","content":[{"type":"image","attrs":{"id":"0b9f4c1e-8a57-4c8f-9b0a-1f2e3d4c5b6a","alt":"지도"}}]}'),
  'image=0b9f4c1e-8a57-4c8f-9b0a-1f2e3d4c5b6a', 'an uploaded image');
select is(
  pg_temp.refs('{"type":"doc","content":[{"type":"image","attrs":{"id":"../a.png","alt":""}}]}'),
  '', 'an image with a bad id');
select is(
  pg_temp.refs('{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"학교","marks":[{"type":"link","attrs":{"href":"https://kmla.hs.kr"}}]}]}]}'),
  '', 'an external link');
select is(
  pg_temp.refs('{"type":"doc","content":[{"type":"paragraph"}],"attrs":{"redirect":"PRISM"}}'),
  'link=PRISM redirect=PRISM', 'a redirect');
select is(
  pg_temp.refs('{"type":"doc","content":[{"type":"paragraph"}],"attrs":{"redirect":""}}'),
  '', 'an empty redirect');
select is(
  pg_temp.refs('{"type":"doc","content":[{"type":"codeBlock","content":[{"type":"text","text":"[[코드]] {{틀:코드}}"}]},{"type":"paragraph","content":[{"type":"text","text":"[[가짜]]","marks":[{"type":"code"}]}]}]}'),
  '', 'code is plain text');

-- 저장할 때 쓰는 보조 함수.
select is(private.doc_is_empty(wiki('')), true, 'an empty paragraph is an empty document');
select is(private.doc_is_empty(wiki('[[분류:생활]]')), false, 'a category is content');
select is(private.doc_is_empty('{"type":"doc","content":[{"type":"horizontalRule"}]}'), false,
  'a block that is not a paragraph is content');
select is(
  private.doc_text('{"type":"doc","content":[
    {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"제목"}]},
    {"type":"paragraph","content":[{"type":"text","text":"굵","marks":[{"type":"bold"}]},{"type":"text","text":"게"},
      {"type":"footnote","content":[{"type":"text","text":"각"},{"type":"hardBreak"},{"type":"text","text":"주","marks":[{"type":"wikiLink","attrs":{"target":"각주"}}]}]}]},
    {"type":"fold","attrs":{"title":"접기"},"content":[{"type":"paragraph","content":[{"type":"text","text":"안"}]}]}
  ]}'),
  E'제목\n굵게 각\n주\n접기\n안',
  'visible text joins pieces of a paragraph and puts blocks on their own lines'
);
select is(
  private.doc_text('{"type":"doc","content":[
    {"type":"image","attrs":{"id":"0b9f4c1e-8a57-4c8f-9b0a-1f2e3d4c5b6a","alt":"대체"},
      "content":[{"type":"caption","content":[{"type":"text","text":" 본관 "},{"type":"text","text":"앞 ","marks":[{"type":"bold"}]}]}]},
    {"type":"youtube","attrs":{"videoId":"dQw4w9WgXcQ"},
      "content":[{"type":"caption","content":[{"type":"text","text":"학교 소개"},{"type":"footnote","content":[{"type":"text","text":"주"}]}]}]},
    {"type":"image","attrs":{"id":"0b9f4c1e-8a57-4c8f-9b0a-1f2e3d4c5b6a","alt":"대체만"},"content":[{"type":"caption"}]}
  ]}'),
  E'본관 앞\n학교 소개 주\n',
  'image and video captions are visible text, alt text is not'
);

select * from finish();
rollback;
