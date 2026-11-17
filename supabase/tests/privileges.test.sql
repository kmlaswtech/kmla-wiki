-- 권한의 전수 검사. 새 테이블이나 함수를 추가하면서 GRANT/REVOKE를 빠뜨리면 여기서 걸린다.
begin;
\ir helpers.inc
select * from no_plan();

-- 테스트 도우미 함수는 검사 대상이 아니다.
create temp view app_functions as
  select proc.oid, proc.proname, nsp.nspname
  from pg_proc as proc
  join pg_namespace as nsp on nsp.oid = proc.pronamespace
  where nsp.nspname in ('public', 'private')
    and proc.proname not in ('login', 'logout');

select is_empty(
  $$select format('%I.%I', schemaname, tablename)
    from pg_tables
    where schemaname in ('public', 'private')
      and (has_table_privilege('anon', format('%I.%I', schemaname, tablename), 'select')
        or has_table_privilege('anon', format('%I.%I', schemaname, tablename), 'insert'))$$,
  'anon has no access to any table'
);

-- 예외는 일시 정지 방지용 `keepalive()` 하나다(아무것도 읽지 않는다).
select set_eq(
  $$select format('%I.%I', nspname, proname) from app_functions
    where has_function_privilege('anon', oid, 'execute')$$,
  array['public.keepalive'],
  'anon can execute only keepalive()'
);

set local role anon;
select is(public.keepalive(), true, 'anon can call keepalive()');
reset role;

-- 쓰기는 전부 RPC다.
select is_empty(
  $$select format('%I.%I', schemaname, tablename)
    from pg_tables
    where schemaname in ('public', 'private')
      and (has_table_privilege('authenticated', format('%I.%I', schemaname, tablename), 'insert')
        or has_table_privilege('authenticated', format('%I.%I', schemaname, tablename), 'update')
        or has_table_privilege('authenticated', format('%I.%I', schemaname, tablename), 'delete')
        or has_table_privilege('authenticated', format('%I.%I', schemaname, tablename), 'truncate'))$$,
  'authenticated cannot write to any table directly'
);

select is_empty(
  -- 조건 평가 순서가 보장되지 않으므로 이름은 항상 그 행의 schema로 만든다.
  $$select tablename from pg_tables
    where schemaname = 'private'
      and has_table_privilege('authenticated', format('%I.%I', schemaname, tablename), 'select')$$,
  'authenticated cannot read any private table'
);

select is_empty(
  $$select format('%I.%I', schemaname, tablename) from pg_tables
    where schemaname in ('public', 'private') and not rowsecurity$$,
  'every table has row level security enabled'
);

-- definer 함수는 search_path를 비워야 한다.
select is_empty(
  $$select format('%I.%I', nsp.nspname, proc.proname)
    from pg_proc as proc
    join pg_namespace as nsp on nsp.oid = proc.pronamespace
    where nsp.nspname in ('public', 'private')
      and proc.proname not in ('login', 'logout')
      and proc.prosecdef
      and not coalesce(proc.proconfig @> array['search_path=""'], false)$$,
  'every security definer function pins an empty search_path'
);

-- 반환값과 화면용 테이블에 내부 식별자가 없다.
select is_empty(
  $$select format('%I.%I', table_name, column_name)
    from information_schema.columns
    where table_schema = 'public'
      and column_name ~ '(member_id|profile_id|auth_user_id)'$$,
  'no public table carries a member or profile identifier'
);

select is_empty(
  $$select proname from app_functions
    where nspname = 'public'
      and pg_get_function_result(oid) ~ '(member_id|profile_id|auth_user_id)'$$,
  'no public function returns a member or profile identifier'
);

-- private 함수 가운데 브라우저 역할이 부를 수 있는 것은 정해져 있다.
select set_eq(
  $$select proname::text from app_functions
    where nspname = 'private' and has_function_privilege('authenticated', oid, 'execute')$$,
  array[
    'can_read', 'can_edit', 'is_admin',
    'normalize_title', 'is_valid_title', 'title_key', 'extract_refs',
    'empty_doc', 'doc_text', 'doc_is_empty', 'check_body'
  ],
  'authenticated can execute only the policy helpers and pure title/markup functions in private'
);

select * from finish();
rollback;
