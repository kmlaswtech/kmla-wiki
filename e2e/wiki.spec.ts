import { expect, test, type Page } from "@playwright/test";

/** 테스트끼리, 그리고 앞선 실행과 겹치지 않는 문서 이름. */
const RUN = Date.now().toString(36);
const title = (name: string) => `E2E ${name} ${RUN}`;
const path = (name: string, action = "w") =>
  `/${action}/${encodeURIComponent(title(name).replaceAll(" ", "_"))}`;

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("개발용 계정").selectOption(email);
  await page.getByRole("button", { name: "이 계정으로 들어가기" }).click();
}

async function loginAsMember(page: Page, email = "alice@wiki.test") {
  await login(page, email);
  await expect(page.getByRole("link", { name: "큼온 위키" })).toBeVisible();
}

/** 편집기. 문서 보기와 같은 모양으로 그리는 편집 칸이다. */
const editorOf = (page: Page) => page.locator(".wiki-editor");

/**
 * 편집기에 글을 넣는다. 기존 내용은 지운다. 줄마다 친다(빈 줄은 건너뛴다). 줄 맨 앞의 `## `는
 * 편집기가 제목으로 바꾼다.
 */
async function writeBody(page: Page, body: string) {
  await editorOf(page).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  const lines = body.split("\n").filter((line) => line !== "");
  for (const [index, line] of lines.entries()) {
    if (index > 0) await page.keyboard.press("Enter");
    await page.keyboard.type(line);
  }
}

async function createPage(page: Page, name: string, body: string) {
  await page.goto(path(name, "edit"));
  await writeBody(page, body);
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title(name));
}

test("회원 확인이 없는 계정은 들어오지 못한다", async ({ page }) => {
  await login(page, "outsider@wiki.test");
  await expect(
    page.getByText("승인된 KMLA Online 회원만 이용할 수 있습니다."),
  ).toBeVisible();

  await page.goto("/w/귀가");
  await expect(page).toHaveURL(/\/login\?/);
});

test("확인 기간이 지난 회원은 보던 곳을 기억한 채 로그인 화면으로 간다", async ({
  page,
}) => {
  await login(page, "expired@wiki.test");
  await page.goto("/w/귀가");
  await expect(page).toHaveURL(/\/login\?next=%2Fw%2F.*reason=expired/);
  await expect(page.getByText("회원 확인 기간이 지났습니다.")).toBeVisible();
});

test("문서를 읽는다: 목차, 각주, 분류, 틀, 넘겨주기", async ({ page }) => {
  await loginAsMember(page);

  await page.goto("/w/귀가");
  await expect(page.getByRole("navigation", { name: "목차" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "각주" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "생활", exact: true }),
  ).toBeVisible();
  // 없는 문서로 가는 링크는 빨간 링크다.
  await expect(page.getByRole("link", { name: "외출·외박" })).toHaveClass(
    /wiki-link-missing/,
  );

  // 하위 문서: 상위 경로와 끼워 넣은 틀.
  await page.getByRole("link", { name: "귀가/정기 귀가" }).first().click();
  await expect(
    page.getByRole("navigation", { name: "상위 문서" }),
  ).toContainText("귀가");
  await expect(
    page.getByText("이 문서의 내용은 바뀌었을 수 있습니다."),
  ).toBeVisible();
  await expect(page.locator(".wiki-content u")).toHaveText("금요일");

  // 넘겨주기 문서 자체 보기.
  await page.goto("/w/중베?redirect=no");
  await expect(page.getByText("문서로 넘겨줍니다.")).toBeVisible();
});

test("문서를 만들고, 고치고, 기록에서 내 판을 본다", async ({ page }) => {
  await loginAsMember(page);

  await page.goto(path("새 문서"));
  await expect(page.getByText("이 문서는 아직 없습니다.")).toBeVisible();
  await page.getByRole("link", { name: "이 문서 만들기" }).click();

  await writeBody(
    page,
    "첫 문장.\n\n## 문단 가\n\n가 내용\n\n## 문단 나\n\n나 내용\n\n## 문단 다\n\n다 내용",
  );
  // 쓰는 대로 문서 모양이 된다.
  await expect(
    editorOf(page).getByRole("heading", { name: "문단 가" }),
  ).toBeVisible();
  await page.getByLabel("편집 요약 (선택)").fill("처음 씀");
  await page.getByRole("button", { name: "저장" }).click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    title("새 문서"),
  );
  await expect(page.getByRole("navigation", { name: "목차" })).toContainText(
    "문단 나",
  );

  // 문단 편집: 그 문단만 열린다.
  await page
    .getByRole("heading", { name: /문단 나/ })
    .getByRole("link", { name: "편집" })
    .click();
  await expect(editorOf(page)).toContainText("나 내용");
  await expect(editorOf(page)).not.toContainText("가 내용");
  await writeBody(page, "## 문단 나\n\n고친 나 내용");
  // 저장 전에 바꾼 곳을 본다.
  await page.getByRole("tab", { name: "변경 사항" }).click();
  await expect(
    page.getByRole("region", { name: "변경 사항" }).locator("ins"),
  ).toContainText("고친");
  await page.getByRole("button", { name: "저장" }).click();

  await expect(page.locator(".wiki-content")).toContainText("고친 나 내용");
  await expect(page.locator(".wiki-content")).toContainText("가 내용");
  await expect(page.locator(".wiki-content")).toContainText("다 내용");

  // 기록: 두 판, 내 판 표시, 가명.
  await page.getByRole("link", { name: "기록" }).click();
  const rows = page
    .getByRole("listitem")
    .filter({ hasText: /익명#[0-9A-F]{6}/ });
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("나");
  await expect(rows.last()).toContainText("처음 씀");

  // 판 비교.
  await rows.first().getByRole("link", { name: "비교" }).click();
  await expect(page.locator("ins")).toContainText("고친");

  // 고른 두 판 비교. 처음에는 최신 판과 그 앞 판이 골라져 있다.
  await page.goBack();
  await page.getByRole("button", { name: "고른 두 판 비교" }).click();
  await expect(page.locator("ins")).toContainText("고친");

  // 되돌리기: 확인 창에서 사유를 받고, 편집 요약이 자동으로 채워진다.
  await page.goBack();
  await rows.last().getByRole("button", { name: "이 판으로 되돌리기" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("사유 (선택)").fill("시험 되돌림");
  await dialog.getByRole("button", { name: "되돌리기", exact: true }).click();
  await expect(page.locator(".wiki-content")).toContainText("나 내용");
  await expect(page.locator(".wiki-content")).not.toContainText("고친 나 내용");

  await page.getByRole("link", { name: "기록" }).click();
  await expect(rows.first()).toContainText(/r\d+ 판으로 되돌림: 시험 되돌림/);
});

test("편집기에서 이미지를 올리면 커서 자리에 들어가 바로 보인다", async ({
  page,
}) => {
  await loginAsMember(page);
  await page.goto(path("이미지", "edit"));
  await writeBody(page, "사진 앞 문장");

  // 2×2 빨간 PNG.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==",
    "base64",
  );
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "이미지" }).click();
  await (
    await chooser
  ).setFiles({ name: "빨간 점.png", mimeType: "image/png", buffer: png });

  await expect(
    editorOf(page).getByRole("img", { name: "빨간 점" }),
  ).toBeVisible();
  // 설명은 파일 이름에서 채워지고, 고칠 수 있다.
  await expect(page.getByLabel("이미지 설명")).toHaveValue("빨간 점");

  await page.getByRole("button", { name: "저장" }).click();
  await expect(
    page.locator(".wiki-content").getByRole("img", { name: "빨간 점" }),
  ).toBeVisible();
});

test("특수 기능: 작성이 필요한 문서, 모든 문서", async ({ page }) => {
  await loginAsMember(page);
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "둘러보기" })
    .getByRole("link", { name: "특수 기능" })
    .click();

  // seed의 귀가 문서가 아직 없는 외출·외박을 링크한다. 다른 테스트가 남긴 빨간 링크가 쌓여
  // 100개 안에 안 들 수 있으므로, 목록이 그려지는 것만 본다.
  await expect(page.getByText(/^링크 \d+개$/).first()).toBeVisible();

  // 일반 문서는 테스트가 계속 쌓으므로, 문서가 적은 위키 이름공간으로 확인한다.
  await page.getByRole("link", { name: "모든 문서" }).click();
  await page.getByRole("link", { name: "위키", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "위키:편집 도움말" }),
  ).toBeVisible();
});

test("툴바로 꾸미고 각주와 표를 넣는다", async ({ page }) => {
  await loginAsMember(page);
  await page.goto(path("툴바", "edit"));
  const editor = editorOf(page);

  await editor.click();
  await page.getByRole("button", { name: "굵게", exact: true }).click();
  await page.keyboard.type("중요");
  await expect(editor.locator("strong")).toHaveText("중요");

  await page.getByRole("button", { name: "각주", exact: true }).click();
  const footnote = page.getByRole("dialog");
  await footnote.getByLabel("각주 내용").fill("출처");
  await footnote.getByRole("button", { name: "넣기" }).click();
  await expect(editor.getByRole("button", { name: "각주: 출처" })).toBeVisible();

  await page.getByRole("button", { name: "표", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "넣기" }).click();
  await expect(editor.getByRole("table")).toBeVisible();

  // 저장하면 문서 보기에도 같은 모양이다.
  await page.getByRole("button", { name: "저장" }).click();
  const content = page.locator(".wiki-content");
  await expect(content.locator("strong")).toHaveText("중요");
  await expect(content.getByRole("table")).toBeVisible();
  await expect(content.locator("section[data-footnotes]")).toContainText("출처");
});

test("[[를 치면 링크 창이 열리고, 자동완성으로 문서를 고른다", async ({ page }) => {
  await loginAsMember(page);
  await page.goto(path("자동완성", "edit"));

  await editorOf(page).click();
  await page.keyboard.type("[[");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("문서 이름 또는 주소").pressSequentially("귀가/");
  await page.getByRole("option", { name: "귀가/정기 귀가" }).click();
  await dialog.getByRole("button", { name: "넣기" }).click();
  await expect(
    editorOf(page).locator('a[data-wiki-target="귀가/정기 귀가"]'),
  ).toHaveText("귀가/정기 귀가");

  // 후보를 고르지 않고 Enter를 치면 쓴 그대로 넣는다.
  await page.keyboard.press("End");
  await page.keyboard.type(" [[");
  await dialog.getByLabel("문서 이름 또는 주소").fill("신성");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(
    editorOf(page).locator('a[data-wiki-target="신성"]'),
  ).toHaveText("신성");
});

test("다른 사람이 먼저 고치면 내 글을 지키고 차이를 보여 준다", async ({
  page,
  browser,
}) => {
  await loginAsMember(page);
  await createPage(page, "충돌", "원래 내용");

  // 앨리스가 편집을 연다.
  await page.goto(path("충돌", "edit"));
  await writeBody(page, "앨리스가 고친 내용");

  // 그 사이 밥이 저장한다.
  const other = await browser.newContext();
  const bob = await other.newPage();
  await loginAsMember(bob, "bob@wiki.test");
  await bob.goto(path("충돌", "edit"));
  await writeBody(bob, "밥이 고친 내용");
  await bob.getByRole("button", { name: "저장" }).click();
  await expect(bob.locator(".wiki-content")).toContainText("밥이 고친 내용");
  await other.close();

  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("다른 사람이 먼저 고쳤습니다")).toBeVisible();
  await expect(editorOf(page)).toContainText("앨리스가 고친 내용");
  await expect(page.locator("del")).toContainText("밥이");

  // 확인하고 다시 저장하면 들어간다.
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.locator(".wiki-content")).toContainText(
    "앨리스가 고친 내용",
  );

  // 두 사람의 가명은 다르다.
  await page.getByRole("link", { name: "기록" }).click();
  const rows = page
    .getByRole("listitem")
    .filter({ hasText: /익명#[0-9A-F]{6}/ });
  // 만든 판, 밥의 판, 앨리스의 판.
  await expect(rows).toHaveCount(3);
  const pseudonyms = (await rows.allTextContents()).map(
    (text) => /익명#[0-9A-F]{6}/.exec(text)?.[0],
  );
  expect(new Set(pseudonyms).size).toBe(2);
});

test("검색, 이동, 최근 변경", async ({ page }) => {
  await loginAsMember(page);
  await createPage(page, "이동 전", `찾을말${RUN} 이 들어 있는 문서`);

  // 후보 목록이 열려 있는 동안은 목록 바깥이 접근성 트리에서 빠진다. Enter로 검색한다.
  await page.getByLabel("문서 검색").fill(`찾을말${RUN}`);
  await page.getByLabel("문서 검색").press("Enter");
  await expect(
    page.getByRole("link", { name: title("이동 전") }),
  ).toBeVisible();

  await page.goto(path("이동 전", "move"));
  await page.getByLabel("새 이름").fill(title("이동 후"));
  await page.getByRole("button", { name: "이동" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    title("이동 후"),
  );

  // 옛 이름은 새 이름으로 넘겨준다.
  await page.goto(path("이동 전"));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    title("이동 후"),
  );
  await expect(page.getByText("에서 넘어옴")).toBeVisible();

  await page.goto("/recent");
  await expect(
    page.getByRole("link", { name: title("이동 후") }).first(),
  ).toBeVisible();
});

test("관리자가 훼손에 대응한다: 다른 편집 보기, 차단, 판 숨기기, 보호", async ({
  page,
  browser,
}) => {
  // 밥이 두 문서를 만든다.
  const other = await browser.newContext();
  const bob = await other.newPage();
  await loginAsMember(bob, "bob@wiki.test");
  await createPage(bob, "관리 하나", "처음 내용");
  await createPage(bob, "관리 둘", "다른 문서 내용");
  await bob.goto(path("관리 하나", "edit"));
  await writeBody(bob, "고친 내용");
  await bob.getByRole("button", { name: "저장" }).click();
  await expect(bob.locator(".wiki-content")).toContainText("고친 내용");

  await loginAsMember(page, "admin@wiki.test");
  await page.goto(path("관리 하나", "history"));
  const rows = page
    .getByRole("listitem")
    .filter({ hasText: /익명#[0-9A-F]{6}/ });
  await expect(rows).toHaveCount(2);

  // 같은 사람의 다른 편집: 사유를 적어야 보인다.
  await rows.last().getByRole("button", { name: /관리$/ }).click();
  await page
    .getByRole("menuitem", { name: "이 사람의 다른 편집 보기" })
    .click();
  await page.getByLabel("조회 사유").fill("E2E 훼손 확인");
  await page.getByRole("button", { name: "조회" }).click();
  await expect(
    page.getByRole("link", { name: title("관리 둘") }),
  ).toBeVisible();

  // 예전 판 숨기기.
  await page.goto(path("관리 하나", "history"));
  await rows.last().getByRole("button", { name: /관리$/ }).click();
  await page.getByRole("menuitem", { name: "이 판 숨기기" }).click();
  await page.getByLabel(/^사유/).fill("E2E 숨김");
  await page.getByRole("button", { name: "숨기기" }).click();
  await expect(rows.last()).toContainText("숨김");

  // 차단.
  await rows.first().getByRole("button", { name: /관리$/ }).click();
  await page.getByRole("menuitem", { name: "이 사람 차단" }).click();
  await page.getByLabel(/^사유/).fill("E2E 차단");
  await page.getByRole("button", { name: "차단", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  // 밥: 숨긴 판은 안 보이고, 다른 문서도 못 고친다.
  await bob.goto(path("관리 하나", "history"));
  await expect(
    bob.getByRole("listitem").filter({ hasText: /익명#[0-9A-F]{6}/ }),
  ).toHaveCount(1);
  await bob.goto(path("관리 둘", "edit"));
  await expect(bob.getByText("편집이 차단된 상태입니다").first()).toBeVisible();
  await other.close();

  // 공개 기록과 차단 내역, 해제.
  await page.goto("/log");
  // 로컬 DB에 앞선 실행의 기록이 쌓여 있다. 최신이 맨 위다.
  await expect(page.getByText("E2E 훼손 확인").first()).toBeVisible();
  await page.goto("/bans");
  const ban = page
    .getByRole("listitem")
    .filter({ hasText: "E2E 차단" })
    .first();
  await expect(ban).toContainText("차단 중");
  await ban.getByRole("button", { name: "해제" }).click();
  await page.getByLabel(/^사유/).fill("E2E 정리");
  await page.getByRole("dialog").getByRole("button", { name: "해제" }).click();
  await expect(ban).toContainText("해제됨");

  // 문서 보호.
  await page.goto(path("관리 둘"));
  await page.getByRole("button", { name: "문서 관리" }).click();
  await page.getByRole("menuitem", { name: "문서 보호" }).click();
  await page.getByLabel(/^사유/).fill("E2E 보호");
  await page.getByRole("button", { name: "보호", exact: true }).click();
  await expect(page.getByLabel("보호된 문서")).toBeVisible();
});
