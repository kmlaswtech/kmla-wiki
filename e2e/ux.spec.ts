import { expect, test, type Page } from "@playwright/test";

/** 테스트끼리, 그리고 앞선 실행과 겹치지 않는 문서 이름. */
const RUN = Date.now().toString(36);
const title = (name: string) => `UX ${name} ${RUN}`;
const path = (name: string, action = "w") =>
  `/${action}/${encodeURIComponent(title(name).replaceAll(" ", "_"))}`;

async function loginAsMember(page: Page) {
  await page.goto("/login");
  await page.getByLabel("개발용 계정").selectOption("alice@wiki.test");
  await page.getByRole("button", { name: "이 계정으로 들어가기" }).click();
  await expect(page.getByRole("link", { name: "큼온 위키" })).toBeVisible();
}

async function writeBody(page: Page, body: string) {
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText(body);
}

async function createPage(page: Page, name: string, body: string) {
  await page.goto(path(name, "edit"));
  await writeBody(page, body);
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title(name));
}

test("편집 중 글을 잃지 않는다: 취소 확인, 나가기 확인, 단축키 저장", async ({
  page,
}) => {
  await loginAsMember(page);
  await page.goto(path("편집 보호", "edit"));
  await writeBody(page, "첫 내용");

  // 고친 뒤 취소하면 묻는다.
  await page.getByRole("link", { name: "취소" }).click();
  await expect(page.getByText("쓰던 글을 버릴까요?")).toBeVisible();
  await page.getByRole("button", { name: "계속 쓰기" }).click();
  await expect(page).toHaveURL(/\/edit\//);

  // Ctrl/⌘+S로 저장한다.
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    title("편집 보호"),
  );
  await expect(page.locator(".wiki-content")).toContainText("첫 내용");

  // 고치던 중 다른 화면으로 가면 묻고, 나가도 임시 저장이 남는다.
  await page.goto(path("편집 보호", "edit"));
  await writeBody(page, "둘째 내용");
  await page.getByRole("link", { name: "최근 변경" }).click();
  await expect(page.getByText("편집을 그만두고 나갈까요?")).toBeVisible();
  await page.getByRole("button", { name: "나가기" }).click();
  await expect(page).toHaveURL(/\/recent$/);

  await page.goto(path("편집 보호", "edit"));
  await expect(
    page.getByText("저장하지 않은 글을 불러왔습니다."),
  ).toBeVisible();
  await page.getByRole("button", { name: "버리고 현재 판으로" }).click();
  await expect(page.locator(".cm-content")).toHaveText("첫 내용");

  // 고친 것이 없으면 묻지 않고 나간다.
  await page.getByRole("link", { name: "취소" }).click();
  await expect(page).toHaveURL(/\/w\//);
});

test("검색창: 후보를 골라 바로 가고, 정확한 제목은 Enter로 바로 연다", async ({
  page,
}) => {
  await loginAsMember(page);
  await createPage(page, "검색 대상", "검색 본문");

  const search = page.getByRole("combobox", { name: "문서 검색" });
  await search.fill(`검색 대상 ${RUN}`);
  await page
    .getByRole("option", { name: title("검색 대상"), exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(path("검색 대상")));

  await page.goto("/recent");
  await search.fill(title("검색 대상"));
  await search.press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    title("검색 대상"),
  );

  // 결과 목록을 보고 싶으면 "전체 검색"을 고른다.
  await search.fill(`대상 ${RUN}`);
  await page.getByRole("option", { name: /전체 검색/ }).click();
  await expect(page).toHaveURL(/\/search\?q=/);
  await expect(
    page.getByRole("link", { name: title("검색 대상") }),
  ).toBeVisible();
});

test("문서 읽기: 최근 수정 시각, 제목 번호, 문단 접기, 각주 미리보기", async ({
  page,
}) => {
  await loginAsMember(page);
  await createPage(
    page,
    "읽기",
    "## 가\n\n가 본문[^1]\n\n### 가 아래\n\n아래 본문\n\n## 나\n\n나 본문\n\n[^1]: 각주 내용입니다",
  );

  await expect(page.getByText(/^최근 수정 /)).toBeVisible();

  // 제목 번호는 목차와 같고, 누르면 목차로 간다.
  const heading = page.getByRole("heading", { name: /가 아래/ });
  await expect(heading).toContainText("1.1.");
  await heading.getByRole("link", { name: "1.1." }).click();
  await expect(page).toHaveURL(/#toc$/);

  // 문단을 접으면 하위 문단까지 숨는다.
  await page.getByRole("button", { name: "가 문단 접기" }).click();
  await expect(page.getByText("가 본문")).toBeHidden();
  await expect(page.getByText("아래 본문")).toBeHidden();
  await expect(page.getByText("나 본문")).toBeVisible();
  await page.getByRole("button", { name: "가 문단 펼치기" }).click();
  await expect(page.getByText("아래 본문")).toBeVisible();

  // 각주 번호를 누르면 그 자리에 내용이 뜨고, 아래로 내려가지 않는다.
  await page.goto(path("읽기"));
  await page.getByRole("button", { name: "각주 1" }).click();
  await expect(
    page.locator("[data-slot=popover-content]").getByText("각주 내용입니다"),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/#/);
});
