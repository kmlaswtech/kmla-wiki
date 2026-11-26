-- 곁의 최근 변경(`listRecentlyChangedPages`)은 문서를 현재 판 id 내림차순으로 앞 10개만 읽는다.
-- 모든 위키 화면이 30~60초마다 부르므로, 문서 표 전체를 정렬하지 않고 색인 앞부분만 읽게 한다.
create index pages_current_revision_idx on public.pages (current_revision_id desc)
  where current_revision_id is not null;
