-- 위키:편집 도움말 문서의 처음 판. 편집 화면의 안내문과 툴바 도움말 버튼이 이 문서를 가리킨다.
--
-- seed는 원격에 넣지 않으므로, 운영에도 있어야 하는 이 문서는 마이그레이션으로 넣는다.
-- 회원이 쓴 판이 아니라서 `save_revision`을 거치지 않고 직접 넣는다. 작성자 기록
-- (`private.revision_authors`)은 남기지 않고, 이름은 관리 조치와 같게 "관리자"로 둔다.
-- 이미 같은 제목의 문서가 있으면 건드리지 않는다.
do $$
declare
  v_title constant text := '위키:편집 도움말';
  v_body jsonb;
  v_page_id bigint;
  v_revision_id bigint;
begin
  if exists (select 1 from public.pages where title_key = lower(v_title)) then
    return;
  end if;

  v_body := private.doc_of(
    private.doc_para(private.doc_text_node(
      '큼온 위키는 학생들이 함께 쓰는 학교생활 안내서입니다. 틀려도 괜찮습니다. 다른 사람이 고칩니다.'
    )),

    private.doc_heading(2, '지켜야 할 것'),
    private.doc_list(
      private.doc_para(private.doc_text_node('학교생활에 관한 정보를 적습니다. 학교 밖에 그대로 퍼져도 괜찮은 내용만 씁니다.')),
      private.doc_para(private.doc_text_node('특정 학생·교직원에 대한 문서를 만들거나, 누구인지 알 수 있게 쓰지 않습니다.')),
      private.doc_para(private.doc_text_node('편집자는 문서마다 다른 가명으로 표시됩니다. 그래도 저장한 글은 판 기록에 계속 남습니다.')),
      private.doc_para(private.doc_text_node('다른 사람의 편집에 동의하지 않으면, 지우기 전에 편집 요약에 이유를 적어 주세요.'))
    ),

    private.doc_heading(2, '쓰는 법'),
    private.doc_para(private.doc_text_node(
      '편집 화면은 문서와 똑같이 보입니다. 쓰는 대로 바로 적용되니 문법을 외울 필요가 없습니다. 글자를 고르고 툴바의 단추를 누르면 '
    ), private.doc_text_node('굵게', 'bold'), private.doc_text_node(', '),
       private.doc_text_node('밑줄', 'underline'), private.doc_text_node(', '),
       private.doc_text_node('취소선', 'strike'), private.doc_text_node('이 들어갑니다.')),
    private.doc_para(private.doc_text_node(
      '키보드가 편하면 줄 맨 앞에 ## (큰 제목), ### (중간 제목), - (글머리 목록), 1. (번호 목록), > (인용)을 치고 띄어 써도 됩니다. Ctrl+B는 굵게, Ctrl+Z는 실행 취소입니다.'
    )),

    private.doc_heading(2, '링크'),
    private.doc_para(private.doc_text_node(
      '툴바의 링크 단추를 누르거나 [[ 를 치면 링크 창이 열립니다. 문서 이름을 쓰면 자동완성이 뜹니다. 문서의 한 문단으로 가려면 "문서 이름#문단 제목", 바깥 사이트로 가려면 https://로 시작하는 주소를 씁니다.'
    )),
    private.doc_para(private.doc_text_node(
      '아직 없는 문서로 건 링크는 빨간색으로 보입니다. 눌러서 그 문서를 만들 수 있습니다.'
    )),

    private.doc_heading(2, '문단과 목차'),
    private.doc_para(private.doc_text_node(
      '제목으로 문단을 나눕니다. 큰 제목 아래에 중간·작은 제목을 두면 하위 문단이 됩니다. 제목이 셋 이상이면 목차가 생깁니다. 문서 화면에서 문단 제목 옆의 편집 단추를 누르면 그 문단만 고칠 수 있습니다.'
    )),

    private.doc_heading(2, '각주'),
    private.doc_para(private.doc_text_node(
      '각주 단추를 누르고 내용을 적으면 커서 자리에 번호가 붙고, 내용은 문서 맨 아래에 모입니다. 번호를 누르면 내용을 고치거나 지울 수 있습니다. 출처 주소를 적으면 누를 수 있는 링크가 됩니다.'
    )),

    private.doc_heading(2, '이미지'),
    private.doc_para(private.doc_text_node(
      '툴바의 이미지 단추를 누르거나, 편집기에 이미지를 붙여넣거나 끌어다 놓습니다. 이미지 아래 칸에는 무엇을 찍은 사진인지 적어 주세요. 화면 낭독기가 읽습니다.'
    )),
    private.doc_para(private.doc_text_node(
      '사진의 위치 정보는 올릴 때 지워집니다. 사람 얼굴이 알아볼 수 있게 나온 사진은 올리지 않습니다.'
    )),

    private.doc_heading(2, '표'),
    private.doc_para(private.doc_text_node(
      '표 단추로 넣습니다. 표 안에 커서를 두면 같은 단추가 표 메뉴로 바뀌어, 줄·칸을 더하거나 지우고 칸을 합칠 수 있습니다.'
    )),

    private.doc_heading(2, '접기와 틀'),
    private.doc_para(private.doc_text_node(
      '더보기 메뉴의 접기를 고르면 제목을 누를 때만 펼쳐지는 상자가 생깁니다. 틀 넣기(또는 {{ 입력)를 고르면 틀 문서의 내용이 그 자리에 들어갑니다. 여러 문서에 똑같이 붙는 안내문에 씁니다.'
    )),

    private.doc_heading(2, '분류'),
    private.doc_para(private.doc_text_node(
      '편집기 아래의 분류 칸에 분류 이름을 쓰고 Enter를 누릅니다. 분류 문서에서 같은 분류의 문서를 모아 볼 수 있습니다.'
    )),

    private.doc_heading(2, '하위 문서'),
    private.doc_para(private.doc_text_node(
      '제목에 /를 넣으면 하위 문서가 됩니다. "귀가/정기 귀가"는 "귀가"의 하위 문서이고, 상위 문서 화면에 목록으로 나옵니다.'
    )),

    private.doc_heading(2, '넘겨주기'),
    private.doc_para(private.doc_text_node(
      '다른 이름으로도 찾아오게 하려면, 그 이름으로 문서를 만들고 더보기 메뉴의 넘겨주기에서 원래 문서를 고릅니다.'
    )),

    private.doc_heading(2, '실수했을 때'),
    private.doc_para(private.doc_text_node(
      '문서의 기록 화면에서 예전 판으로 되돌릴 수 있습니다. 판 두 개를 골라 무엇이 바뀌었는지 비교할 수도 있습니다.'
    ))
  );

  insert into public.pages (title) values (v_title) returning id into v_page_id;

  insert into public.revisions (
    page_id, parent_revision_id, body, summary, author_pseudonym, kind, byte_size, byte_delta
  )
  values (
    v_page_id, null, v_body, '처음 판', '관리자', 'edit',
    octet_length(private.doc_text(v_body)), octet_length(private.doc_text(v_body))
  )
  returning id into v_revision_id;

  update public.pages set current_revision_id = v_revision_id where id = v_page_id;

  insert into public.page_refs (from_page_id, kind, target_key)
  select distinct v_page_id, ref.kind, lower(ref.target)
  from private.extract_refs(v_body) as ref
  where ref.kind <> 'redirect';
end;
$$;
