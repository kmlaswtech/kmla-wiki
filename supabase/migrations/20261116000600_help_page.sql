-- 위키:편집 도움말 문서의 처음 판. 편집 화면의 안내문과 툴바 도움말 버튼이 이 문서를 가리킨다.
--
-- seed는 원격에 넣지 않으므로, 운영에도 있어야 하는 이 문서는 마이그레이션으로 넣는다.
-- 회원이 쓴 판이 아니라서 `save_revision`을 거치지 않고 직접 넣는다. 작성자 기록
-- (`private.revision_authors`)은 남기지 않고, 이름은 관리 조치와 같게 "관리자"로 둔다.
-- 이미 같은 제목의 문서가 있으면 건드리지 않는다.
do $$
declare
  v_title constant text := '위키:편집 도움말';
  v_body constant text := $body$큼온 위키는 학생들이 함께 쓰는 학교생활 안내서입니다. 틀려도 괜찮습니다. 다른 사람이 고칩니다.

## 지켜야 할 것

- 학교생활에 관한 정보를 적습니다. 학교 밖에 그대로 퍼져도 괜찮은 내용만 씁니다.
- 특정 학생·교직원에 대한 문서를 만들거나, 누구인지 알 수 있게 쓰지 않습니다.
- 편집자는 문서마다 다른 가명으로 표시됩니다. 그래도 저장한 글은 판 기록에 계속 남습니다.
- 다른 사람의 편집에 동의하지 않으면, 지우기 전에 편집 요약에 이유를 적어 주세요.

## 글자

| 하고 싶은 것 | 이렇게 씁니다 |
| --- | --- |
| 굵게 | `**글자**` |
| 밑줄 | `__글자__` |
| 취소선 | `~~글자~~` |

## 링크

- 다른 문서: `[[문서 이름]]`
- 보여 줄 글자를 바꾸려면: `[[문서 이름|보여 줄 글자]]`
- 문서의 한 문단으로: `[[문서 이름#문단 제목]]`
- 바깥 사이트: `[보여 줄 글자](https://주소)`

아직 없는 문서로 건 링크는 빨간색으로 보입니다. 눌러서 그 문서를 만들 수 있습니다.

## 문단과 목차

`## 제목`으로 문단을 나눕니다. `###`, `####`로 더 작은 문단을 만듭니다. 제목이 셋 이상이면 목차가 생깁니다.

문단 제목 옆의 편집 버튼을 누르면 그 문단만 고칠 수 있습니다.

## 각주

문장 뒤에 `[^1]`을 붙이고, 문서 끝에 `[^1]: 각주 내용`을 씁니다. 툴바의 각주 버튼을 쓰면 번호를 알아서 붙입니다.

## 이미지

툴바의 이미지 버튼을 누르거나, 편집기에 이미지를 붙여넣거나 끌어다 놓습니다. 올린 이미지는 커서 자리에 `![설명](img:…)` 꼴로 들어갑니다. 대괄호 안의 설명은 화면 낭독기가 읽으니 무엇을 찍은 사진인지 적어 주세요.

사진의 위치 정보는 올릴 때 지워집니다. 사람 얼굴이 알아볼 수 있게 나온 사진은 올리지 않습니다.

## 접기

```
:::접기 제목
접어 둘 내용
:::
```

## 틀

`{{틀:틀 이름}}`을 쓰면 그 틀 문서의 내용이 그 자리에 들어갑니다. 여러 문서에 똑같이 붙는 안내문에 씁니다.

## 분류

문서 끝에 `[[분류:분류 이름]]`을 씁니다. 분류 문서에서 같은 분류의 문서를 모아 볼 수 있습니다.

## 하위 문서

제목에 `/`를 넣으면 하위 문서가 됩니다. `귀가/정기 귀가`는 `귀가`의 하위 문서이고, 상위 문서 화면에 목록으로 나옵니다.

## 넘겨주기

다른 이름으로도 찾아오게 하려면, 그 이름으로 문서를 만들고 첫 줄에 `#넘겨주기 [[원래 문서]]`만 씁니다.

## 실수했을 때

문서의 기록 화면에서 예전 판으로 되돌릴 수 있습니다. 판 두 개를 골라 무엇이 바뀌었는지 비교할 수도 있습니다.$body$;
  v_page_id bigint;
  v_revision_id bigint;
begin
  if exists (select 1 from public.pages where title_key = lower(v_title)) then
    return;
  end if;

  insert into public.pages (title) values (v_title) returning id into v_page_id;

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
