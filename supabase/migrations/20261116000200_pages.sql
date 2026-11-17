-- 문서, 판, 문서별 가명.
--
-- 오류 코드(클라이언트는 `app/features/pages/model/errors.ts`에서 문구로 바꾼다)
--   42501  회원 확인이 없거나 권한이 없음
--   WK001  편집 충돌: 내가 본 판 이후에 다른 편집이 있었다
--   WK002  차단된 사용자
--   WK003  보호된 문서
--   WK004  쓸 수 없는 제목
--   WK005  안전 상한 초과(본문·요약 길이, 저장 빈도)
--   WK006  대상이 없음
--   WK007  바뀐 내용이 없음
--   WK008  삭제된 문서
--   WK009  이미 있는 제목
--   WK012  본문 형식이 맞지 않음(문서 JSON이 아니거나 허용하지 않는 주소)

-- ── 제목 ─────────────────────────────────────────────────────────────────────
-- 제목이 곧 주소다. 저장하기 전에 항상 이 함수를 거친다.
--  * 유니코드 NFC, 공백·밑줄 묶음은 공백 하나(주소에서는 공백을 밑줄로 쓴다)
--  * `/`와 이름공간 `:` 둘레의 공백 제거
create function private.normalize_title(p_title text) returns text
language sql immutable set search_path = ''
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        btrim(regexp_replace(normalize(coalesce(p_title, ''), NFC), '[[:space:]_]+', ' ', 'g')),
        ' */ *', '/', 'g'
      ),
      '^(틀|분류|위키) *: *', '\1:'
    ),
    ''
  );
$$;

-- 정규화된 제목이 문서 이름으로 쓸 수 있는지. 금지 문자는 위키 문법과 주소에서 뜻이 있는 것들이다.
create function private.is_valid_title(p_title text) returns boolean
language sql immutable set search_path = ''
as $$
  select p_title is not null
    and char_length(p_title) between 1 and 100
    and p_title !~ '[][{}|#<>\\[:cntrl:]]'
    and p_title !~ '^[/:]'
    and p_title !~ '/$'
    and p_title !~ '//'
    -- 주소 경로에서 `.`과 `..`은 상위 경로로 해석된다.
    and p_title !~ '(^|/)\.{1,2}(/|$)'
    -- 이름공간만 있고 이름이 없는 제목.
    and p_title !~ '^(틀|분류|위키):$';
$$;

-- 제목 비교 키. 대소문자를 구분하지 않는다(`PRISM`과 `Prism`은 같은 문서).
create function private.title_key(p_title text) returns text
language sql immutable set search_path = ''
as $$
  select lower(private.normalize_title(p_title));
$$;

revoke all on function private.normalize_title(text) from public;
revoke all on function private.is_valid_title(text) from public;
revoke all on function private.title_key(text) from public;
grant execute on function private.normalize_title(text) to authenticated;
grant execute on function private.is_valid_title(text) to authenticated;
grant execute on function private.title_key(text) to authenticated;

-- ── 문서 ─────────────────────────────────────────────────────────────────────
create table public.pages (
  id bigint generated always as identity primary key,
  -- 항상 `private.normalize_title()`을 거친 값이다.
  title text not null,
  title_key text generated always as (lower(title)) stored,
  namespace text generated always as (
    case
      when title like '틀:%' then 'template'
      when title like '분류:%' then 'category'
      when title like '위키:%' then 'wiki'
      else 'main'
    end
  ) stored,
  -- 슬래시 앞부분. `귀가/정기 귀가`의 상위는 `귀가`다. 상위 문서가 실제로 없어도 된다.
  parent_key text generated always as (
    case when title like '%/%' then lower(regexp_replace(title, '/[^/]*$', '')) end
  ) stored,
  -- 넘겨주기 문서면 대상 제목. 본문(문서 속성 `redirect`)에서 서버가 뽑는다.
  redirect_target text,
  redirect_key text generated always as (lower(redirect_target)) stored,
  current_revision_id bigint,
  protection text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint pages_title_key_unique unique (title_key),
  constraint pages_protection check (protection in ('open', 'admin'))
);

create index pages_parent_idx on public.pages (parent_key) where parent_key is not null;
create index pages_redirect_idx on public.pages (redirect_key) where redirect_key is not null;

-- ── 판 ───────────────────────────────────────────────────────────────────────
-- 판마다 본문 전체를 저장한다. 판 비교와 되돌리기가 단순해진다.
--
-- 본문은 편집기(Tiptap/ProseMirror)가 내놓는 문서 JSON 그대로다(`app/features/markup/model/doc.ts`).
--   { "type": "doc", "attrs": { "categories": [...], "redirect": "..." }, "content": [블록...] }
-- 링크·틀·이미지는 노드·마크로 따로 있어 파싱 없이 그 자리를 읽는다(`private.extract_refs`).
create table public.revisions (
  id bigint generated always as identity primary key,
  page_id bigint not null references public.pages (id) on delete cascade,
  parent_revision_id bigint references public.revisions (id) on delete set null,
  body jsonb not null,
  summary text not null default '',
  -- **이 문서에서의** 가명. 쓰는 순간 확정하고, 읽는 쪽은 실제 작성자를 참조하지 않는다.
  author_pseudonym text not null,
  kind text not null,
  -- 보이는 글자(`private.doc_text`)의 바이트 수. 꾸밈만 바꾼 편집은 0이다.
  byte_size integer not null,
  byte_delta integer not null,
  created_at timestamptz not null default now(),
  -- 관리자가 숨긴 판. 일반 사용자에게는 행 자체가 보이지 않는다.
  hidden_at timestamptz,
  constraint revisions_kind check (kind in ('edit', 'revert', 'move', 'delete', 'restore'))
);

create index revisions_page_idx on public.revisions (page_id, id desc);

alter table public.pages
  add constraint pages_current_revision_fkey
  foreign key (current_revision_id) references public.revisions (id) on delete set null;

-- ── 문서가 가리키는 것 ───────────────────────────────────────────────────────
-- 링크·틀·분류·이미지를 한 표에 둔다. 넷 다 "이 문서가 저 이름을 이런 뜻으로 가리킨다"이고,
-- 본문에서 서버가 뽑아 채운다(`private.extract_refs`). 역링크, 빨간 링크, 분류 목록, 틀 사용
-- 문서 목록, 미사용 이미지 찾기가 모두 이 표의 조회다.
create table public.page_refs (
  from_page_id bigint not null references public.pages (id) on delete cascade,
  kind text not null,
  -- link·template·category는 제목 키, image는 이미지 id.
  target_key text not null,
  primary key (from_page_id, kind, target_key),
  constraint page_refs_kind check (kind in ('link', 'template', 'category', 'image'))
);

create index page_refs_target_idx on public.page_refs (kind, target_key);

-- ── 가명과 실제 작성자 (private) ─────────────────────────────────────────────
-- 문서마다 따로 배정한다. 여러 문서의 편집을 모아 한 사람을 추적할 수 없게 하는 장치이고,
-- 문서 사이를 잇는 정보는 이 표에만 있다.
create table private.page_pseudonyms (
  page_id bigint not null references public.pages (id) on delete cascade,
  member_id bigint not null references private.members (id) on delete cascade,
  pseudonym text not null,
  primary key (page_id, member_id),
  constraint page_pseudonyms_unique_per_page unique (page_id, pseudonym)
);

create table private.revision_authors (
  revision_id bigint primary key references public.revisions (id) on delete cascade,
  member_id bigint not null references private.members (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index revision_authors_member_idx on private.revision_authors (member_id, created_at desc);

alter table private.page_pseudonyms enable row level security;
alter table private.revision_authors enable row level security;

-- ── 읽기 권한 ────────────────────────────────────────────────────────────────
alter table public.pages enable row level security;
alter table public.revisions enable row level security;
alter table public.page_refs enable row level security;

grant select on public.pages, public.revisions, public.page_refs to authenticated;

-- 삭제된 문서는 관리자에게만 보인다.
create policy pages_select on public.pages for select to authenticated
  using (
    (select private.can_read())
    and (deleted_at is null or (select private.is_admin()))
  );

-- 숨긴 판과 삭제된 문서의 판은 관리자에게만 보인다. 문서 쪽 조건은 pages 정책이 그대로 적용된다.
create policy revisions_select on public.revisions for select to authenticated
  using (
    (select private.can_read())
    and (hidden_at is null or (select private.is_admin()))
    and exists (select 1 from public.pages as page where page.id = revisions.page_id)
  );

create policy page_refs_select on public.page_refs for select to authenticated
  using (
    (select private.can_read())
    and exists (select 1 from public.pages as page where page.id = page_refs.from_page_id)
  );

-- ── 본문 다루기 ──────────────────────────────────────────────────────────────
-- 빈 문서. 본문이 없는 판(삭제된 문서 등)을 읽을 때 쓴다.
create function private.empty_doc() returns jsonb
language sql immutable set search_path = ''
as $$
  select '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb;
$$;

-- 보이는 글자만 편다: 글자, 각주 내용, 접기 제목. 검색, 검색 결과 발췌, 글자 수(`byte_size`)에 쓴다.
-- 한 문단 안의 글자 조각(꾸밈마다 나뉜다)은 그대로 잇고, 블록 사이는 줄을 바꾼다. 그래야 "신성 시간"
-- 처럼 꾸밈 경계를 넘는 말도 찾힌다.
create function private.doc_text(p_body jsonb) returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v_type text := p_body ->> 'type';
  v_separator text;
  v_out text;
  v_children text;
begin
  if jsonb_typeof(p_body) is distinct from 'object' then
    return '';
  end if;
  case v_type
    when 'text' then return coalesce(p_body ->> 'text', '');
    when 'footnote' then return ' ' || coalesce(p_body -> 'attrs' ->> 'note', '');
    when 'hardBreak' then return E'\n';
    else null;
  end case;

  v_separator := case when v_type in ('paragraph', 'heading', 'codeBlock') then '' else E'\n' end;
  -- 접기는 제목도 보이는 글자다.
  v_out := case when v_type = 'fold' then nullif(p_body -> 'attrs' ->> 'title', '') end;
  -- 자식 글자는 한 번에 잇는다. 하나씩 덧붙이면 글이 길수록 앞부분을 거듭 복사한다.
  if jsonb_typeof(p_body -> 'content') = 'array' then
    select string_agg(private.doc_text(child.value), v_separator order by child.position)
    into v_children
    from jsonb_array_elements(p_body -> 'content') with ordinality as child (value, position);
    v_out := case when v_out is null then v_children
                  when v_children is null then v_out
                  else v_out || v_separator || v_children end;
  end if;
  return coalesce(v_out, '');
end;
$$;

-- 판의 보이는 글자. 검색할 때마다 JSON을 다시 펴지 않게 저장할 때 한 번 펴 둔다.
alter table public.revisions
  add column body_text text generated always as (private.doc_text(body)) stored;

-- 아무것도 없는 문서인가: 빈 문단만 있고 분류·넘겨주기도 없다. 새 문서를 빈 채로 만들지 않는다.
create function private.doc_is_empty(p_body jsonb) returns boolean
language sql immutable set search_path = ''
as $$
  select not jsonb_path_exists(
      p_body,
      'strict $.content[*] ? (@.type != "paragraph" || exists(@.content[*]))'
    )
    and coalesce(p_body -> 'attrs' ->> 'redirect', '') = ''
    and coalesce(jsonb_array_length(p_body -> 'attrs' -> 'categories'), 0) = 0;
$$;

-- 저장할 수 있는 본문인지. 모양이 문서 JSON이고, 바깥 링크 주소가 http(s)·mailto뿐이어야 한다.
-- 화면도 같은 주소만 링크로 그리지만(`WikiContent`), 저장 단계에서 한 번 더 막는다.
-- 지나치게 깊은 중첩도 막는다. `doc_text`가 노드마다 재귀하므로 스택 한도 오류가 그대로 나간다.
-- (속성이 빠진 노드는 `extract_refs`·`doc_text`가 건너뛰므로 따로 막지 않는다.)
create function private.check_body(p_body jsonb) returns void
language plpgsql immutable set search_path = ''
as $$
begin
  -- 노드 한 겹이 JSON 두 겹(`content` 배열과 노드)이다. 편집기에서 만드는 문서는 이보다 훨씬 얕다.
  if jsonb_path_exists(p_body, 'strict $.**{200}') then
    raise exception 'invalid body' using errcode = 'WK012';
  end if;

  if jsonb_typeof(p_body) is distinct from 'object'
     or p_body ->> 'type' is distinct from 'doc'
     or jsonb_typeof(p_body -> 'content') is distinct from 'array'
     or (p_body ? 'attrs' and jsonb_typeof(p_body -> 'attrs') <> 'object')
     or (coalesce(p_body -> 'attrs', '{}'::jsonb) ? 'categories'
         and jsonb_typeof(p_body -> 'attrs' -> 'categories') <> 'array')
     or (coalesce(p_body -> 'attrs', '{}'::jsonb) ? 'redirect'
         and jsonb_typeof(p_body -> 'attrs' -> 'redirect') <> 'string') then
    raise exception 'invalid body' using errcode = 'WK012';
  end if;

  if jsonb_path_exists(
    p_body,
    'strict $.** ? (@.type == "link").attrs.href ? (!(@ like_regex "^(https?:|mailto:)" flag "i"))'
  ) then
    raise exception 'unsafe link' using errcode = 'WK012', detail = 'link';
  end if;

  -- 제목 단계는 편집기가 쓰는 2~4만. 화면은 범위 밖 값을 맞춰 그리지만 저장부터 막는다.
  if jsonb_path_exists(
    p_body,
    'strict $.** ? (@.type == "heading").attrs.level ? (!(@ == 2 || @ == 3 || @ == 4))'
  ) then
    raise exception 'invalid body' using errcode = 'WK012';
  end if;
end;
$$;

-- SQL로 문서를 쓸 때(운영 문서 마이그레이션, seed, 테스트) 쓰는 짧은 도우미. 화면에서는 쓰지 않는다.
--   private.doc_of(private.doc_heading(2, '제목'), private.doc_para(private.doc_text_node('글')))
create function private.doc_text_node(p_text text, variadic p_marks text[] default '{}')
returns jsonb
language sql immutable set search_path = ''
as $$
  select case when cardinality(p_marks) = 0
    then jsonb_build_object('type', 'text', 'text', p_text)
    else jsonb_build_object(
      'type', 'text', 'text', p_text,
      'marks', (select jsonb_agg(jsonb_build_object('type', mark)) from unnest(p_marks) as mark)
    )
  end;
$$;

-- 위키 링크가 걸린 글자. `p_label`이 비면 제목이 보인다.
create function private.doc_link(p_target text, p_label text default null)
returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_object(
    'type', 'text', 'text', coalesce(p_label, p_target),
    'marks', jsonb_build_array(jsonb_build_object(
      'type', 'wikiLink', 'attrs', jsonb_build_object('target', p_target, 'section', '')
    ))
  );
$$;

create function private.doc_para(variadic p_inline jsonb[]) returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_object('type', 'paragraph', 'content', to_jsonb(p_inline));
$$;

create function private.doc_heading(p_level integer, p_text text) returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_object(
    'type', 'heading', 'attrs', jsonb_build_object('level', p_level),
    'content', jsonb_build_array(private.doc_text_node(p_text))
  );
$$;

-- 글머리 목록. 항목마다 문단 하나.
create function private.doc_list(variadic p_items jsonb[]) returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_object('type', 'bulletList', 'content', (
    select jsonb_agg(jsonb_build_object('type', 'listItem', 'content', jsonb_build_array(item)))
    from unnest(p_items) as item
  ));
$$;

create function private.doc_of(variadic p_blocks jsonb[]) returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_object('type', 'doc', 'content', to_jsonb(p_blocks));
$$;

revoke all on function private.doc_text_node(text, text[]) from public;
revoke all on function private.doc_link(text, text) from public;
revoke all on function private.doc_para(jsonb[]) from public;
revoke all on function private.doc_heading(integer, text) from public;
revoke all on function private.doc_list(jsonb[]) from public;
revoke all on function private.doc_of(jsonb[]) from public;

revoke all on function private.empty_doc() from public;
revoke all on function private.doc_text(jsonb) from public;
revoke all on function private.doc_is_empty(jsonb) from public;
revoke all on function private.check_body(jsonb) from public;
grant execute on function private.empty_doc() to authenticated;
grant execute on function private.doc_text(jsonb) to authenticated;
grant execute on function private.doc_is_empty(jsonb) to authenticated;
grant execute on function private.check_body(jsonb) to authenticated;

-- ── 본문에서 가리키는 것 뽑기 ────────────────────────────────────────────────
-- 화면(`app/features/markup/model/refs.ts`)과 같은 규칙이어야 한다. 두 쪽의 테스트가 같은 사례
-- 표를 쓴다(`test/features/markup/model/ref-cases.ts`, `supabase/tests/extract_refs.test.sql`).
--
--  * 넘겨주기: 문서 속성 `redirect`. 대상으로 가는 링크로도 센다.
--  * 분류: 문서 속성 `categories`. `분류:`를 빼고 적었어도 같은 분류다.
--  * 링크: `wikiLink` 마크의 `target`. 비어 있으면 같은 문서 안의 문단이라 세지 않는다.
--  * 틀: `template` 노드의 `name`. `틀:`을 빼고 적었어도 같은 틀이다.
--  * 이미지: `image` 노드의 `id`(uuid).
--
-- 클라이언트가 계산해 보내지 않는 이유: 조작된 요청으로 본문에 없는 넘겨주기나 분류를 심을 수
-- 있기 때문이다.
create function private.extract_refs(p_body jsonb)
returns table (kind text, target text)
language plpgsql immutable set search_path = ''
as $$
declare
  v_body jsonb := coalesce(p_body, '{}'::jsonb);
  v_raw text;
  v_title text;
begin
  if jsonb_typeof(v_body -> 'attrs' -> 'redirect') = 'string' then
    v_title := private.normalize_title(v_body -> 'attrs' ->> 'redirect');
    -- 넘겨주기는 대상으로 가는 링크이기도 하다(역링크에 넘겨주기 문서가 보인다).
    if private.is_valid_title(v_title) then
      kind := 'redirect';
      target := v_title;
      return next;
      kind := 'link';
      return next;
    end if;
  end if;

  if jsonb_typeof(v_body -> 'attrs' -> 'categories') = 'array' then
    for v_raw in
      select item #>> '{}'
      from jsonb_array_elements(v_body -> 'attrs' -> 'categories') as item
      where jsonb_typeof(item) = 'string'
    loop
      v_title := private.normalize_title(v_raw);
      if v_title is not null and v_title !~ '^분류:' then
        v_title := private.normalize_title('분류:' || v_title);
      end if;
      if private.is_valid_title(v_title) then
        kind := 'category';
        target := v_title;
        return next;
      end if;
    end loop;
  end if;

  for v_raw in
    select found.value #>> '{}'
    from jsonb_path_query(v_body, 'strict $.** ? (@.type == "wikiLink").attrs.target')
      as found (value)
    where jsonb_typeof(found.value) = 'string'
  loop
    v_title := private.normalize_title(v_raw);
    if private.is_valid_title(v_title) then
      kind := 'link';
      target := v_title;
      return next;
    end if;
  end loop;

  for v_raw in
    select found.value #>> '{}'
    from jsonb_path_query(v_body, 'strict $.** ? (@.type == "template").attrs.name')
      as found (value)
    where jsonb_typeof(found.value) = 'string'
  loop
    v_title := private.normalize_title(v_raw);
    if v_title is not null and v_title !~ '^틀:' then
      v_title := private.normalize_title('틀:' || v_title);
    end if;
    if private.is_valid_title(v_title) then
      kind := 'template';
      target := v_title;
      return next;
    end if;
  end loop;

  for v_raw in
    select found.value #>> '{}'
    from jsonb_path_query(v_body, 'strict $.** ? (@.type == "image").attrs.id')
      as found (value)
    where jsonb_typeof(found.value) = 'string'
  loop
    if v_raw ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      kind := 'image';
      target := v_raw;
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function private.extract_refs(jsonb) from public;
grant execute on function private.extract_refs(jsonb) to authenticated;

-- ── 쓰기 내부 함수 ───────────────────────────────────────────────────────────
-- 호출자 검증: 회원 확인과 차단. 통과하면 member id를 돌려준다.
create function private.require_editor() returns bigint
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_member_id bigint := private.current_member_id();
begin
  if v_member_id is null then
    raise exception 'membership verification required' using errcode = '42501';
  end if;
  if private.member_is_banned(v_member_id) then
    raise exception 'banned' using errcode = 'WK002';
  end if;
  return v_member_id;
end;
$$;

-- 이 문서에서의 가명. 처음 편집할 때 무작위로 배정한다. 회원 번호의 해시가 아니라 무작위 값이라
-- 거꾸로 계산할 수 없다.
create function private.pseudonym_for(p_page_id bigint, p_member_id bigint) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_pseudonym text;
begin
  select assigned.pseudonym into v_pseudonym
  from private.page_pseudonyms as assigned
  where assigned.page_id = p_page_id and assigned.member_id = p_member_id;

  if v_pseudonym is not null then
    return v_pseudonym;
  end if;

  -- 16진수 6자리(약 1,600만 가지). 같은 문서 안에서 겹치면 다시 뽑는다.
  for attempt in 1..20 loop
    v_pseudonym := '익명#' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    begin
      insert into private.page_pseudonyms (page_id, member_id, pseudonym)
      values (p_page_id, p_member_id, v_pseudonym);
      return v_pseudonym;
    exception when unique_violation then
      -- 같은 사람이 동시에 두 번 저장했다면 먼저 들어간 가명을 쓴다.
      select assigned.pseudonym into v_pseudonym
      from private.page_pseudonyms as assigned
      where assigned.page_id = p_page_id and assigned.member_id = p_member_id;
      if v_pseudonym is not null then
        return v_pseudonym;
      end if;
    end;
  end loop;

  raise exception 'could not assign a pseudonym';
end;
$$;

-- 판을 하나 쓰고 문서의 현재 판과 파생 정보를 갱신한다. 판을 만드는 모든 RPC가 이 함수 하나를
-- 쓴다. 호출자는 문서 행을 `for update`로 잠근 상태여야 한다.
create function private.write_revision(
  p_page_id bigint,
  p_member_id bigint,
  p_body jsonb,
  p_summary text,
  p_kind text,
  -- 관리 조치(삭제·복구)는 가명 대신 "관리자"로 남긴다.
  p_as_admin boolean default false
) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_parent_id bigint;
  v_parent_size integer;
  v_revision_id bigint;
  v_size integer := octet_length(private.doc_text(p_body));
begin
  select page.current_revision_id, revision.byte_size
  into v_parent_id, v_parent_size
  from public.pages as page
  left join public.revisions as revision on revision.id = page.current_revision_id
  where page.id = p_page_id;

  insert into public.revisions (
    page_id, parent_revision_id, body, summary, author_pseudonym, kind, byte_size, byte_delta
  )
  values (
    p_page_id,
    v_parent_id,
    p_body,
    coalesce(btrim(p_summary), ''),
    case when p_as_admin then '관리자' else private.pseudonym_for(p_page_id, p_member_id) end,
    p_kind,
    v_size,
    v_size - coalesce(v_parent_size, 0)
  )
  returning id into v_revision_id;

  insert into private.revision_authors (revision_id, member_id)
  values (v_revision_id, p_member_id);

  -- 본문에서 뽑는 일은 한 번만 한다. 넘겨주기 대상과 나머지 참조를 같은 결과에서 나눈다.
  delete from public.page_refs where from_page_id = p_page_id;
  with refs as materialized (
    select ref.kind, ref.target from private.extract_refs(p_body) as ref
  ),
  updated as (
    update public.pages
       set current_revision_id = v_revision_id,
           updated_at = now(),
           redirect_target = (select refs.target from refs where refs.kind = 'redirect' limit 1)
     where id = p_page_id
  )
  insert into public.page_refs (from_page_id, kind, target_key)
  select distinct p_page_id, refs.kind, lower(refs.target)
  from refs
  where refs.kind <> 'redirect';

  return v_revision_id;
end;
$$;

-- 사람은 닿지 않는 안전 상한. 편집 횟수를 제한하려는 것이 아니라, 스크립트로 Free 한도(DB 500MB)를
-- 채우는 것을 막는다. 관리자는 훼손을 한꺼번에 되돌려야 하므로 빈도 상한에서 뺀다.
-- 본문 상한은 JSON 크기로 잰다. 꾸밈·구조 정보가 붙어 글자만 셀 때보다 몇 배 크다(글자로는
-- 20만 자 안팎).
create function private.check_write_limits(p_member_id bigint, p_body jsonb, p_summary text) returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if octet_length(p_body::text) > 1000000 then
    raise exception 'body too long' using errcode = 'WK005', detail = 'body';
  end if;
  if char_length(coalesce(p_summary, '')) > 200 then
    raise exception 'summary too long' using errcode = 'WK005', detail = 'summary';
  end if;
  if not private.is_admin() and (
    select count(*) from private.revision_authors as written
    where written.member_id = p_member_id
      and written.created_at > now() - interval '10 minutes'
  ) >= 60 then
    raise exception 'too many edits' using errcode = 'WK005', detail = 'rate';
  end if;
end;
$$;

-- 편집 가능한 상태인지: 삭제·보호. 관리자는 통과한다.
create function private.check_page_writable(p_page public.pages) returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_page.deleted_at is not null and not private.is_admin() then
    raise exception 'page is deleted' using errcode = 'WK008';
  end if;
  if p_page.protection = 'admin' and not private.is_admin() then
    raise exception 'page is protected' using errcode = 'WK003';
  end if;
end;
$$;

revoke all on function private.require_editor() from public;
revoke all on function private.pseudonym_for(bigint, bigint) from public;
revoke all on function private.write_revision(bigint, bigint, jsonb, text, text, boolean) from public;
revoke all on function private.check_write_limits(bigint, jsonb, text) from public;
revoke all on function private.check_page_writable(public.pages) from public;

-- ── 저장 ─────────────────────────────────────────────────────────────────────
-- 새 문서는 `p_base_revision_id`를 NULL로 보낸다. 내가 편집을 시작한 판이 지금의 현재 판이
-- 아니면 충돌이다. 문단 편집도 클라이언트가 전체 본문으로 끼워 넣어 이 함수로 저장한다.
create function public.save_revision(
  p_title text,
  p_base_revision_id bigint,
  p_body jsonb,
  p_summary text default ''
)
returns table (page_id bigint, revision_id bigint, title text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_member_id bigint := private.require_editor();
  v_title text := private.normalize_title(p_title);
  v_page public.pages;
  v_body jsonb := p_body;
  v_current_body jsonb;
begin
  if not private.is_valid_title(v_title) then
    raise exception 'invalid title' using errcode = 'WK004';
  end if;
  perform private.check_body(v_body);
  perform private.check_write_limits(v_member_id, v_body, p_summary);

  select * into v_page from public.pages as page
  where page.title_key = lower(v_title)
  for update;

  if v_page.id is null then
    if p_base_revision_id is not null then
      raise exception 'page not found' using errcode = 'WK006';
    end if;
    if private.doc_is_empty(v_body) then
      raise exception 'nothing to save' using errcode = 'WK007';
    end if;
    begin
      insert into public.pages (title) values (v_title) returning * into v_page;
    exception when unique_violation then
      -- 같은 제목을 다른 사람이 방금 만들었다.
      raise exception 'edit conflict' using errcode = 'WK001';
    end;
  else
    perform private.check_page_writable(v_page);
    if v_page.current_revision_id is distinct from p_base_revision_id then
      raise exception 'edit conflict' using errcode = 'WK001';
    end if;
    select revision.body into v_current_body
    from public.revisions as revision where revision.id = v_page.current_revision_id;
    if v_current_body = v_body then
      raise exception 'nothing to save' using errcode = 'WK007';
    end if;
  end if;

  page_id := v_page.id;
  title := v_page.title;
  revision_id := private.write_revision(v_page.id, v_member_id, v_body, p_summary, 'edit');
  return next;
end;
$$;

-- 지정한 판의 내용으로 새 판을 만든다. 기록은 지우지 않는다.
create function public.revert_page(p_revision_id bigint, p_summary text default '')
returns table (page_id bigint, revision_id bigint, title text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_member_id bigint := private.require_editor();
  v_target public.revisions;
  v_page public.pages;
  v_current_body jsonb;
  v_summary text;
begin
  select * into v_target from public.revisions as revision where revision.id = p_revision_id;
  -- 숨긴 판은 관리자만 되살릴 수 있다. 없는 판과 같은 오류로 답해 존재를 알리지 않는다.
  if v_target.id is null or (v_target.hidden_at is not null and not private.is_admin()) then
    raise exception 'revision not found' using errcode = 'WK006';
  end if;

  select * into v_page from public.pages as page where page.id = v_target.page_id for update;
  perform private.check_page_writable(v_page);

  select revision.body into v_current_body
  from public.revisions as revision where revision.id = v_page.current_revision_id;
  if v_current_body = v_target.body then
    raise exception 'nothing to save' using errcode = 'WK007';
  end if;

  v_summary := format('r%s 판으로 되돌림', p_revision_id)
    || case when btrim(coalesce(p_summary, '')) <> '' then ': ' || btrim(p_summary) else '' end;
  perform private.check_write_limits(v_member_id, v_target.body, v_summary);

  page_id := v_page.id;
  title := v_page.title;
  revision_id := private.write_revision(v_page.id, v_member_id, v_target.body, v_summary, 'revert');
  return next;
end;
$$;

-- 문서 이름 바꾸기. page id가 그대로라 판 기록과 가명이 유지된다. 하위 문서는 함께 옮기지 않는다.
create function public.move_page(
  p_title text,
  p_new_title text,
  p_leave_redirect boolean default true
)
returns table (page_id bigint, revision_id bigint, title text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_member_id bigint := private.require_editor();
  v_new_title text := private.normalize_title(p_new_title);
  v_page public.pages;
  v_old_title text;
  v_body jsonb;
  v_redirect_page_id bigint;
begin
  if not private.is_valid_title(v_new_title) then
    raise exception 'invalid title' using errcode = 'WK004';
  end if;

  select * into v_page from public.pages as page
  where page.title_key = private.title_key(p_title)
  for update;
  if v_page.id is null then
    raise exception 'page not found' using errcode = 'WK006';
  end if;
  perform private.check_page_writable(v_page);

  -- 대소문자나 공백만 바꾸는 이동은 같은 문서라 겹침 검사에서 뺀다.
  if lower(v_new_title) <> v_page.title_key and exists (
    select 1 from public.pages as taken where taken.title_key = lower(v_new_title)
  ) then
    raise exception 'title already exists' using errcode = 'WK009';
  end if;
  if v_new_title = v_page.title then
    raise exception 'nothing to save' using errcode = 'WK007';
  end if;

  v_old_title := v_page.title;
  select revision.body into v_body
  from public.revisions as revision where revision.id = v_page.current_revision_id;
  v_body := coalesce(v_body, private.empty_doc());
  perform private.check_write_limits(v_member_id, v_body, '');

  update public.pages set title = v_new_title where id = v_page.id;

  page_id := v_page.id;
  title := v_new_title;
  revision_id := private.write_revision(
    v_page.id, v_member_id, v_body,
    format('%s → %s 이동', v_old_title, v_new_title), 'move'
  );

  if p_leave_redirect and lower(v_old_title) <> lower(v_new_title) then
    insert into public.pages (title) values (v_old_title) returning id into v_redirect_page_id;
    perform private.write_revision(
      v_redirect_page_id, v_member_id,
      jsonb_build_object(
        'type', 'doc',
        'attrs', jsonb_build_object('redirect', v_new_title),
        'content', jsonb_build_array(jsonb_build_object('type', 'paragraph'))
      ),
      format('%s 이동으로 생긴 넘겨주기', v_new_title), 'edit'
    );
  end if;

  return next;
end;
$$;

-- 판 기록에서 내가 쓴 판에 "나"를 표시하려면 이 문서에서의 내 가명이 필요하다. 다른 사람의
-- 가명은 어떤 경로로도 사람과 이어 주지 않는다.
create function public.my_pseudonym(p_page_id bigint) returns text
language sql stable security definer set search_path = ''
as $$
  select assigned.pseudonym
  from private.page_pseudonyms as assigned
  where assigned.page_id = p_page_id
    and assigned.member_id = private.current_member_id();
$$;

-- ── 읽기 ─────────────────────────────────────────────────────────────────────
-- 아래 읽기 함수는 모두 invoker다. 호출자가 볼 수 있는 행만 RLS가 걸러 준다.

-- 본문을 그리는 데 필요한 것: 끼워 넣을 틀의 본문(틀 안의 틀까지 3단계), 링크 대상 가운데
-- 실제로 있는 문서, 이미지 크기. 문서 보기와 편집 미리보기가 같은 함수를 쓴다.
create function public.resolve_body(p_body jsonb) returns jsonb
language sql stable set search_path = ''
as $$
  with recursive body_refs as (
    select ref.kind, lower(ref.target) as target_key
    from private.extract_refs(p_body) as ref
  ),
  templates as (
    select page.id, page.title, page.title_key, 1 as depth
    from body_refs
    join public.pages as page on page.title_key = body_refs.target_key
    where body_refs.kind = 'template'
    union
    select page.id, page.title, page.title_key, templates.depth + 1
    from templates
    join public.page_refs as ref on ref.from_page_id = templates.id and ref.kind = 'template'
    join public.pages as page on page.title_key = ref.target_key
    where templates.depth < 3
  ),
  template_ids as (
    select distinct templates.id, templates.title, templates.title_key from templates
  ),
  all_refs as (
    select body_refs.kind, body_refs.target_key from body_refs
    union
    select ref.kind, ref.target_key
    from template_ids
    join public.page_refs as ref on ref.from_page_id = template_ids.id
  )
  select jsonb_build_object(
    'templates', coalesce((
      select jsonb_agg(jsonb_build_object('title', template_ids.title, 'body', revision.body))
      from template_ids
      join public.pages as page on page.id = template_ids.id
      join public.revisions as revision on revision.id = page.current_revision_id
    ), '[]'::jsonb),
    'existing', coalesce((
      select jsonb_agg(distinct page.title_key)
      from all_refs
      join public.pages as page on page.title_key = all_refs.target_key
      where all_refs.kind in ('link', 'category')
    ), '[]'::jsonb)
  );
$$;

-- 문서 보기 화면 한 번에 필요한 전부.
--  * 넘겨주기는 한 번만 따라간다. 대상이 또 넘겨주기면 그 문서를 그대로 보여 준다.
--  * `p_revision_id`를 주면 그 판의 본문을 본다(판 기록에서 예전 판 보기).
create function public.get_page_view(
  p_title text,
  p_follow_redirect boolean default true,
  p_revision_id bigint default null
) returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  v_title text := private.normalize_title(p_title);
  v_page public.pages;
  v_target public.pages;
  v_redirected_from text;
  v_revision public.revisions;
begin
  -- 회원 확인이 지난 사용자는 RLS 때문에 모든 문서가 "없는 문서"로 보인다. 그렇게 답하면 화면이
  -- 문서를 만들라고 안내하게 되므로, 권한 오류로 알려 로그인 화면으로 보내게 한다.
  if not private.can_read() then
    raise exception 'membership verification required' using errcode = '42501';
  end if;

  select * into v_page from public.pages as page where page.title_key = lower(v_title);

  if v_page.id is not null and p_follow_redirect and p_revision_id is null
     and v_page.redirect_key is not null then
    select * into v_target from public.pages as page where page.title_key = v_page.redirect_key;
    if v_target.id is not null and v_target.id <> v_page.id then
      v_redirected_from := v_page.title;
      v_page := v_target;
    end if;
  end if;

  if v_page.id is null then
    return jsonb_build_object(
      'found', false,
      'title', v_title,
      'valid_title', private.is_valid_title(v_title),
      'can_edit', private.can_edit(),
      'is_admin', private.is_admin(),
      -- 없는 문서도 누가 가리키는지 보여 준다(빨간 링크를 채울 사람에게 맥락이 된다).
      'backlinks', public.page_backlinks(lower(v_title))
    );
  end if;

  select * into v_revision from public.revisions as revision
  where revision.id = coalesce(p_revision_id, v_page.current_revision_id)
    and revision.page_id = v_page.id;

  return jsonb_build_object(
    'found', true,
    'title', v_page.title,
    'redirected_from', v_redirected_from,
    'can_edit', private.can_edit(),
    'is_admin', private.is_admin(),
    'page', jsonb_build_object(
      'id', v_page.id,
      'title', v_page.title,
      'namespace', v_page.namespace,
      'protection', v_page.protection,
      'redirect_target', v_page.redirect_target,
      'current_revision_id', v_page.current_revision_id,
      'updated_at', v_page.updated_at,
      'deleted_at', v_page.deleted_at
    ),
    'revision', case when v_revision.id is null then null else jsonb_build_object(
      'id', v_revision.id,
      'body', v_revision.body,
      'created_at', v_revision.created_at,
      'is_current', v_revision.id = v_page.current_revision_id
    ) end,
    'resolved', public.resolve_body(coalesce(v_revision.body, private.empty_doc())),
    -- 본문 이미지의 경로와 크기. `resolve_images`는 이미지 마이그레이션에서 만든다(plpgsql은
    -- 부르는 순간에 함수를 찾으므로 여기서 써도 된다).
    'images', public.resolve_images(coalesce(v_revision.body, private.empty_doc())),
    'backlinks', public.page_backlinks(v_page.title_key),
    'children', coalesce((
      select jsonb_agg(child.title order by child.title)
      from public.pages as child
      where child.parent_key = v_page.title_key and child.deleted_at is null
    ), '[]'::jsonb),
    -- 분류 문서는 속한 문서를, 틀 문서는 쓰는 문서를 보여 준다.
    'members', case when v_page.namespace in ('category', 'template') then coalesce((
      select jsonb_agg(member.title order by member.title)
      from public.page_refs as ref
      join public.pages as member on member.id = ref.from_page_id
      where ref.kind = v_page.namespace
        and ref.target_key = v_page.title_key
        and member.deleted_at is null
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

-- 이 제목을 가리키는 문서: 본문에서 링크한 문서와 이 문서로 넘겨주는 문서.
create function public.page_backlinks(p_title_key text) returns jsonb
language sql stable set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object('title', linking.title, 'is_redirect', linking.is_redirect)
    order by linking.is_redirect desc, linking.title
  ), '[]'::jsonb)
  from (
    select page.title, page.redirect_key is not distinct from p_title_key as is_redirect
    from public.pages as page
    where page.deleted_at is null
      and page.title_key <> p_title_key
      and (
        page.redirect_key = p_title_key
        or exists (
          select 1 from public.page_refs as ref
          where ref.from_page_id = page.id and ref.kind = 'link' and ref.target_key = p_title_key
        )
      )
    order by page.title
    limit 200
  ) as linking;
$$;

-- 제목, 넘겨주기 이름, 본문 검색. 단순 부분 일치다. 문서 수백 개 규모에서는 순차 검색으로
-- 충분하고, 한국어는 두 글자 검색어("신성")가 많아 trigram 인덱스가 듣지 않는다.
-- 본문은 보이는 글자(판에 저장해 둔 `body_text`)에서 찾는다. 넘겨주기 이름이 맞으면 대상 문서를 돌려준다.
create function public.search_pages(p_query text, p_limit integer default 30)
returns table (title text, matched_redirect text, snippet text, rank smallint)
language sql stable set search_path = ''
as $$
  with query as (
    select lower(btrim(regexp_replace(coalesce(p_query, ''), '[[:space:]]+', ' ', 'g'))) as needle
  ),
  texts as (
    select page.id, revision.body_text as body
    from public.pages as page
    join public.revisions as revision on revision.id = page.current_revision_id
    where page.deleted_at is null and page.redirect_key is null
  ),
  hits as (
    -- 제목
    select page.id, page.title, null::text as matched_redirect,
      case
        when page.title_key = query.needle then 0
        when page.title_key like query.needle || '%' then 1
        else 2
      end as rank
    from public.pages as page, query
    where page.deleted_at is null and page.redirect_key is null
      and strpos(page.title_key, query.needle) > 0
    union all
    -- 넘겨주기 이름
    select target.id, target.title, page.title, 3
    from public.pages as page
    join public.pages as target on target.title_key = page.redirect_key, query
    where page.deleted_at is null and target.deleted_at is null
      and strpos(page.title_key, query.needle) > 0
    union all
    -- 본문
    select page.id, page.title, null, 4
    from texts
    join public.pages as page on page.id = texts.id, query
    where strpos(lower(texts.body), query.needle) > 0
  ),
  best as (
    select distinct on (hits.id) hits.id, hits.title, hits.matched_redirect, hits.rank
    from hits
    order by hits.id, hits.rank
  )
  select
    best.title,
    best.matched_redirect,
    -- 본문에서 맞은 곳 앞뒤.
    (
      select regexp_replace(
        substr(texts.body, greatest(strpos(lower(texts.body), query.needle) - 40, 1), 160),
        '[[:space:]]+', ' ', 'g'
      )
      from texts
      where texts.id = best.id and strpos(lower(texts.body), query.needle) > 0
    ),
    best.rank::smallint
  from best, query
  where char_length(query.needle) >= 1
  order by best.rank, best.title
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

-- 아무 문서로. 넘겨주기·틀·분류·운영 문서는 뺀다.
create function public.random_page() returns text
language sql volatile set search_path = ''
as $$
  select page.title
  from public.pages as page
  where page.namespace = 'main' and page.redirect_key is null and page.deleted_at is null
  order by random()
  limit 1;
$$;

revoke all on function public.save_revision(text, bigint, jsonb, text) from public, anon;
revoke all on function public.revert_page(bigint, text) from public, anon;
revoke all on function public.move_page(text, text, boolean) from public, anon;
revoke all on function public.my_pseudonym(bigint) from public, anon;
revoke all on function public.resolve_body(jsonb) from public, anon;
revoke all on function public.get_page_view(text, boolean, bigint) from public, anon;
revoke all on function public.page_backlinks(text) from public, anon;
revoke all on function public.search_pages(text, integer) from public, anon;
revoke all on function public.random_page() from public, anon;

grant execute on function public.save_revision(text, bigint, jsonb, text) to authenticated;
grant execute on function public.revert_page(bigint, text) to authenticated;
grant execute on function public.move_page(text, text, boolean) to authenticated;
grant execute on function public.my_pseudonym(bigint) to authenticated;
grant execute on function public.resolve_body(jsonb) to authenticated;
grant execute on function public.get_page_view(text, boolean, bigint) to authenticated;
grant execute on function public.page_backlinks(text) to authenticated;
grant execute on function public.search_pages(text, integer) to authenticated;
grant execute on function public.random_page() to authenticated;
