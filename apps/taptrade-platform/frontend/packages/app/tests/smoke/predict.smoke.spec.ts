import {
  test,
  expect,
  assertPageHealthy,
  captureConsoleErrors,
} from "./_shared";

test.describe("/predict — discovery landing", () => {
  test("renders the Moments grid and filters it in place", async ({ page }) => {
    const checkErrors = captureConsoleErrors(page);

    await assertPageHealthy(page, "/predict");

    // The market grid leads the page. The retired "Pick. Win. Redeem."
    // iPhone reward hero must not come back: Points are non-redeemable.
    await expect(
      page.getByRole("heading", { level: 1, name: /trending moments/i }),
    ).toHaveCount(1);
    await expect(page.getByRole("heading", { name: /redeem/i })).toHaveCount(0);
    await expect(page.getByTestId("featured-reward-badge")).toHaveCount(0);
    await expect(page.getByText("Real prizes", { exact: false })).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const grid = document.getElementById("trending-markets");
          return grid ? grid.getBoundingClientRect().top < window.innerHeight : false;
        }),
      )
      .toBe(true);

    const cards = page.getByTestId("market-card");
    const grid = page.getByTestId("market-grid");
    await expect(cards).toHaveCount(9, { timeout: 10_000 });
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    const expectedColumns = viewportWidth > 1120 ? 3 : viewportWidth > 640 ? 2 : 1;
    await expect
      .poll(async () => {
        const template = await grid.evaluate(
          (element) => getComputedStyle(element).gridTemplateColumns,
        );
        return template.split(" ").filter(Boolean).length;
      })
      .toBe(expectedColumns);

    await page.getByRole("button", { name: /load more markets/i }).click();
    await expect(cards).toHaveCount(18, { timeout: 10_000 });

    // The approved discovery card shows both live market sides as
    // percentage actions, not as a dense single-column price table.
    await expect(
      page.getByRole("button", { name: /\d+% buy yes/i }).first(),
    ).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole("button", { name: /\d+% buy no/i }).first(),
    ).toBeVisible();

    // YES/NO open the quick-trade panel in place (Dialog on desktop, vaul
    // Sheet on the <=1023px band) instead of leaving the list.
    await page.getByRole("button", { name: /\d+% buy no/i }).first().click();
    const quickTrade = page.getByRole("dialog");
    await expect(quickTrade).toBeVisible();
    await expect(quickTrade.getByText(/quick trade/i).first()).toBeVisible();
    await expect(
      quickTrade.getByRole("link", { name: /view market details/i }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(quickTrade).toHaveCount(0);
    await expect(page).toHaveURL(/\/predict\/?(\?.*)?$/);

    const search = page.getByRole("searchbox", {
      name: /search markets/i,
    });
    await expect(search).toBeVisible();
    await search.fill("candidate");
    await expect(search).toHaveValue("candidate");

    const closingSoon = page.getByTestId("market-sort-closing_soon");
    await expect(closingSoon).toHaveAttribute("aria-pressed", "false");
    await closingSoon.click();
    await expect(closingSoon).toHaveAttribute("aria-pressed", "true");

    const oneDay = page.getByTestId("market-window-24h");
    await expect(oneDay).toHaveAttribute("aria-pressed", "false");
    await oneDay.click();
    await expect(oneDay).toHaveAttribute("aria-pressed", "true");

    checkErrors();
  });
});
