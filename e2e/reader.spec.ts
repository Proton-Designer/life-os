import { expect, test, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";

// Focus reader acceptance (overnight run-20261019-2250, DESIGN §9): import a
// real EPUB and pasted text through the "Import to read" dialog, read in RSVP,
// change speed, step back, reload and land on the same word. Plus the typed
// error for a PDF with no text layer. Rows this creates are titled "E2E Reader"
// so they can be found and removed afterwards.
const FIXTURES = path.join(__dirname, "fixtures", "reader");

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "Desktop Chrome", "one project is enough: it writes real rows");
});

async function openImportDialog(page: Page) {
  await page.goto("/self-mastery");
  await page.getByRole("button", { name: "Import to read" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

async function wordIndex(page: Page): Promise<number> {
  return Number(await page.getByRole("slider", { name: "Position in book" }).inputValue());
}

async function waitForReader(page: Page) {
  await page.waitForURL(/\/read\/[0-9a-f-]{36}/, { timeout: 60_000 });
  await expect(page.getByTestId("rsvp-view")).toBeVisible({ timeout: 60_000 });
}

test("EPUB: import, read in RSVP, change speed, step back, position survives reload", async ({ page }) => {
  test.setTimeout(180_000);
  await openImportDialog(page);
  await page.getByTestId("import-file-input").setInputFiles(path.join(FIXTURES, "sample.epub"));
  await expect(page.getByTestId("import-file-label")).toHaveText("sample.epub");
  await page.getByRole("dialog").getByRole("button", { name: "Import" }).click();

  const preview = page.getByTestId("import-preview");
  await expect(preview).toBeVisible({ timeout: 60_000 });
  await expect(page.getByLabel("Title")).toHaveValue("E2E Reader Fixture");
  await expect(page.getByTestId("import-stats")).toContainText("2 chapters");
  await page.getByRole("button", { name: "Start reading" }).click();
  await waitForReader(page);

  // Focal letter is drawn in its own span.
  await expect(page.getByTestId("rsvp-focal")).toHaveCount(1);

  // Speed: one step faster changes the readout.
  const wpmBefore = await page.getByTestId("reader-wpm").innerText();
  await page.getByRole("button", { name: "Faster" }).click();
  await expect(page.getByTestId("reader-wpm")).not.toHaveText(wpmBefore);
  const wpmAfter = await page.getByTestId("reader-wpm").innerText();

  // Play for a while, pause, then step back one sentence.
  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForTimeout(4_000);
  await page.getByRole("button", { name: "Pause" }).click();
  const played = await wordIndex(page);
  expect(played).toBeGreaterThan(5);
  await page.getByRole("button", { name: "Back one sentence" }).click();
  await expect.poll(() => wordIndex(page)).toBeLessThan(played);
  const target = await wordIndex(page);

  // Highlight the current sentence; it must come back after the reload.
  const saved = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/read/") && r.ok());
  await page.getByRole("button", { name: "Highlight this sentence" }).click();
  await saved;
  await expect(page.getByRole("button", { name: "Highlights (1)" })).toBeVisible();

  // Server copy: wait for the debounced beacon, then drop local storage so the
  // reload has to come back from the server's bookmark.
  await page.waitForResponse(
    (r) => r.url().includes("/api/reader/position") && r.ok() && JSON.parse(r.request().postData() ?? "{}").wordIndex === target,
    { timeout: 15_000 },
  );
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("rsvp-view")).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => wordIndex(page)).toBe(target);
  await expect(page.getByTestId("reader-wpm")).toHaveText(wpmAfter);
  await page.getByRole("button", { name: "Highlights (1)" }).click();
  await expect(page.getByTestId("highlight-list").locator("li")).toHaveCount(1);
  await expect(page.getByTestId("highlight-list")).toContainText("The First Habit");
});

test("Paste: pasted text opens in the reader", async ({ page }) => {
  test.setTimeout(120_000);
  await openImportDialog(page);
  await page.getByRole("button", { name: "Paste" }).click();
  const text = Array.from({ length: 20 }, (_, i) => `Sentence ${i + 1} of the pasted E2E Reader article keeps the reader busy.`).join(" ");
  await page.getByLabel("Text to read").fill(text);
  await page.getByRole("dialog").getByRole("button", { name: "Import" }).click();
  await expect(page.getByTestId("import-preview")).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Title").fill("E2E Reader Paste");
  await page.getByRole("button", { name: "Start reading" }).click();
  await waitForReader(page);
  await expect(page.getByTestId("rsvp-word")).toContainText(/\S/);

  // Read a little so the server has a bookmark, then Home offers this book back.
  const bookUrl = page.url();
  const bookmarked = page.waitForResponse((r) => r.url().includes("/api/reader/position") && r.ok(), { timeout: 15_000 });
  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForTimeout(2_000);
  await page.getByRole("button", { name: "Pause" }).click();
  await bookmarked;
  await page.goto("/");
  const card = page.getByTestId("continue-reading-card");
  await expect(card).toContainText("Continue reading: E2E Reader Paste", { timeout: 30_000 });
  const wordsToday = async () => Number(/([\d,]+)(?: \/ [\d,]+)? words today/.exec(await card.innerText())?.[1].replace(/,/g, "") ?? NaN);
  const before = await wordsToday();
  await card.click();
  await page.waitForURL(bookUrl);
  await expect(page.getByTestId("rsvp-view")).toBeVisible({ timeout: 60_000 });

  // Leave mid-play: the open reading stretch goes out on pagehide as a keepalive beacon (R7-F1). Playwright doesn't
  // surface requests sent during unload, so check the server's count instead.
  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForTimeout(2_000);
  await page.goto("/");
  await expect.poll(async () => {
    await page.reload();
    return wordsToday();
  }, { timeout: 20_000 }).toBeGreaterThan(before);

  // Library: rename it (title keeps the "E2E Reader" prefix so cleanup still finds it).
  await page.goto("/self-mastery");
  await page.getByRole("button", { name: "Rename E2E Reader Paste" }).first().click();
  await page.getByLabel("Title").fill("E2E Reader Paste Renamed");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Rename E2E Reader Paste Renamed" }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Rename E2E Reader Paste Renamed" }).first()).toBeVisible();
});

test("Library: Try the reader opens the sample book", async ({ page }) => {
  await page.goto("/self-mastery");
  await page.getByRole("link", { name: "Try the reader" }).first().click();
  await page.waitForURL(/\/read\/sample$/);
  await expect(page.getByTestId("rsvp-view")).toBeVisible();
});

test("Scanned PDF: typed error, no book created", async ({ page }) => {
  test.setTimeout(120_000);
  await openImportDialog(page);
  await page.getByTestId("import-file-input").setInputFiles(path.join(FIXTURES, "scanned.pdf"));
  await page.getByRole("dialog").getByRole("button", { name: "Import" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("no selectable text", { timeout: 60_000 });
  await expect(page.getByTestId("import-preview")).toHaveCount(0);
});

test("Library: a file dropped anywhere on the page opens the import preview", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/self-mastery");
  await expect(page.getByRole("button", { name: "Import to read" }).first()).toBeVisible();
  const bytes = fs.readFileSync(path.join(FIXTURES, "sample.epub")).toString("base64");
  const dt = await page.evaluateHandle((b64) => {
    const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([raw], "sample.epub", { type: "application/epub+zip" }));
    return dt;
  }, bytes);
  await page.dispatchEvent("main", "dragenter", { dataTransfer: dt });
  await expect(page.getByTestId("library-drop-hint")).toBeVisible();
  await page.dispatchEvent("main", "drop", { dataTransfer: dt });
  await expect(page.getByTestId("library-drop-hint")).toHaveCount(0);
  await expect(page.getByTestId("import-file-label")).toHaveText("sample.epub");
  // Stop at the selected file: importing it is the EPUB test's job, and this keeps the run from adding a book.
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
});

test("Sample reader fits an iPad portrait screen", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1366 });
  await page.goto("/read/sample");
  await expect(page.getByTestId("rsvp-view")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.getByTestId("reader-controls")).toBeInViewport();
});

test("Speed test: read, answer, get a words-per-minute result", async ({ page }) => {
  await page.goto("/read/speed-test");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByTestId("speed-test-passage")).toBeVisible();
  await page.waitForTimeout(6_000);
  await page.getByRole("button", { name: "Done" }).click();
  for (const group of await page.locator("fieldset").all()) await group.getByRole("radio").first().check();
  await page.getByRole("button", { name: "See my result" }).click();
  await expect(page.getByTestId("speed-test-result")).toContainText("words per minute");
  await expect(page.getByRole("button", { name: /^Use \d+ wpm in the reader$/ })).toBeVisible();
});
