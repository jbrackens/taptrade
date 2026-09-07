import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

/**
 * Canonical browser journey proof for Tap Trade's player app. The user-facing
 * journey is exercised through rendered pages; API calls are used only for
 * admin operations and ledger/settlement assertions that are not yet exposed as
 * one continuous player+office browser workflow.
 */

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(180_000);

async function login(
  request: APIRequestContext,
  username: string,
  password: string,
): Promise<string> {
  const res = await request.post("/api/v1/auth/login", {
    data: { username, password },
  });
  expect(res.ok(), `login ${username} (got ${res.status()})`).toBeTruthy();
  const state = await request.storageState();
  return state.cookies.find((c) => c.name === "csrf_token")?.value ?? "";
}

function csrfHeaders(csrf: string): Record<string, string> {
  return { "X-CSRF-Token": csrf, "Content-Type": "application/json" };
}

function uniqueUsername(): string {
  return `${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}@predict.dev`;
}

async function sessionUser(
  page: Page,
): Promise<{ id: string; username: string }> {
  const res = await page.context().request.get("/api/v1/auth/session");
  expect(res.ok(), `session (got ${res.status()})`).toBeTruthy();
  const body = await res.json();
  const user = body.user ?? { id: body.userId, username: body.username };
  expect(user.id, "session user id").toBeTruthy();
  return user;
}

async function csrfFromPage(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  return cookies.find((cookie) => cookie.name === "csrf_token")?.value ?? "";
}

async function assertNoNextError(page: Page): Promise<void> {
  await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0);
}

test("new user completes the canonical player browser journey through settlement", async ({
  page,
  request,
}) => {
  const username = uniqueUsername();
  const password = "predict123456";
  const proofComment = `Loop 358 browser proof ${Date.now()}`;

  await page.goto("/auth/register/", { waitUntil: "domcontentloaded" });
  await assertNoNextError(page);
  await expect(
    page.getByRole("heading", { name: /create your account/i }),
  ).toBeVisible();
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Email", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(/non-redeemable gameplay points/i)).toBeVisible();
  await page.getByLabel(/points-only no-cashout disclosure/i).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/predict\/?$/, { timeout: 15_000 });
  await assertNoNextError(page);
  const user = await sessionUser(page);
  const userCsrf = await csrfFromPage(page);
  expect(user.username).toBe(username);

  await expect(
    page.getByText(/5000\.00 pts|5,000\.00 pts|5,000 pts/),
  ).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByRole("button", { name: /add to watchlist/i }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /add to watchlist/i })
    .first()
    .click();
  await expect(
    page
      .getByRole("button", { name: /watching|remove from watchlist/i })
      .first(),
  ).toBeVisible();

  await page.getByRole("searchbox", { name: /search_markets/i }).fill("MLBB");
  const canonicalMarketLink = page
    .getByRole("link", { name: /Listed MLBB team wins game one/i })
    .first();
  await expect(canonicalMarketLink).toBeVisible();
  await canonicalMarketLink.click();
  await page.waitForURL(/\/market\/MLBB-FINAL-G1/);
  await assertNoNextError(page);
  await expect(
    page.getByRole("heading", { name: /Listed MLBB team wins game one/i }),
  ).toBeVisible();
  await expect(page.getByText(/resolution/i).first()).toBeVisible();
  await expect(page.getByText(/order book|liquidity/i).first()).toBeVisible();
  await expect(page.getByRole("tab", { name: /^YES\b/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /^NO\b/ })).toBeVisible();

  await page
    .getByRole("button", { name: /Place trade\s*·\s*25\.00 pts/i })
    .click();
  await expect(page.getByText(/Bought|Order accepted|Partially/i)).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("tab", { name: /^NO\b/ }).click();
  await page
    .getByRole("button", { name: /Place trade\s*·\s*25\.00 pts/i })
    .click();
  await expect(page.getByText(/Bought|Order accepted|Partially/i)).toBeVisible({
    timeout: 15_000,
  });

  await page.getByPlaceholder(/resolution sources/i).fill(proofComment);
  await page.getByRole("button", { name: "Post" }).click();
  await expect(page.getByText(proofComment)).toBeVisible({ timeout: 15_000 });
  await page
    .getByRole("button", { name: /^Upvote/i })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: /Upvote · 1/i }).first(),
  ).toBeVisible();
  await page.goto("/users/user-001/", { waitUntil: "domcontentloaded" });
  await assertNoNextError(page);
  await expect(page.getByRole("button", { name: /^Follow$/ })).toBeVisible();
  await page.getByRole("button", { name: /^Follow$/ }).click();
  await expect(page.getByRole("button", { name: /^Following$/ })).toBeVisible();

  await page.goto("/portfolio/", { waitUntil: "domcontentloaded" });
  await assertNoNextError(page);
  await expect(page.getByRole("heading", { name: "Portfolio" })).toBeVisible();
  await expect(
    page.getByText("Open positions, active orders, settled results."),
  ).toBeVisible();
  await expect(page.getByText(/MLBB-FINAL-G1|MLBB/i).first()).toBeVisible();

  await page.goto("/account/transactions/", { waitUntil: "domcontentloaded" });
  await assertNoNextError(page);
  await expect(
    page.getByRole("heading", { name: /Point ledger/i }),
  ).toBeVisible();
  await expect(page.getByText(/Starter points/)).toBeVisible();
  await expect(page.getByText(/Order filled/).first()).toBeVisible();

  await page.goto("/rewards/", { waitUntil: "domcontentloaded" });
  await assertNoNextError(page);
  await expect(page.getByText("Rewards").first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Daily claim/i }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: /Missions/i })).toBeVisible();
  await expect(
    page.getByText(/no cashout|non-redeemable/i).first(),
  ).toBeVisible();
  const firstClaim = page.getByRole("button", { name: /^Claim$/ }).first();
  if ((await firstClaim.count()) > 0 && (await firstClaim.isEnabled())) {
    await firstClaim.click();
    await expect(page.getByText(/pts added to your point ledger/i)).toBeVisible(
      {
        timeout: 15_000,
      },
    );
  }

  const marketRes = await page
    .context()
    .request.get("/api/v1/markets/MLBB-FINAL-G1");
  expect(
    marketRes.ok(),
    `market lookup (got ${marketRes.status()})`,
  ).toBeTruthy();
  const market = await marketRes.json();
  const adminCsrf = await login(request, "admin@taptrade.local", "admin123");
  const close = await request.post(
    `/api/v1/admin/markets/${market.id}/lifecycle/close`,
    {
      headers: csrfHeaders(adminCsrf),
      data: { reason: "Loop 358 browser canonical proof close" },
    },
  );
  expect(close.ok(), `admin close (got ${close.status()})`).toBeTruthy();
  const settle = await request.post(`/api/v1/admin/settlements/${market.id}`, {
    headers: csrfHeaders(adminCsrf),
    data: {
      result: "yes",
      attestationSource: "admin-manual",
      reason: "Loop 358 browser canonical proof settlement",
    },
  });
  expect(settle.ok(), `admin settlement (got ${settle.status()})`).toBeTruthy();
  const settleBody = await settle.json();
  expect(settleBody.unit).toBe("PTS");
  expect(settleBody.pointDisbursements).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ userId: user.id, unit: "PTS" }),
    ]),
  );
  expect(settleBody).not.toHaveProperty("payouts");
  await request.post("/api/v1/admin/leaderboards/pnl_weekly/recompute", {
    headers: csrfHeaders(adminCsrf),
  });

  const ledger = await page
    .context()
    .request.get(`/api/v1/wallet/${user.id}/ledger?limit=50`, {
      headers: csrfHeaders(userCsrf),
    });
  expect(ledger.ok(), `user ledger (got ${ledger.status()})`).toBeTruthy();
  const ledgerBody = await ledger.json();
  expect(
    (ledgerBody.items ?? []).some((entry: { idempotencyKey?: string }) =>
      (entry.idempotencyKey ?? "").startsWith(
        `prediction_payout:${market.id}:`,
      ),
    ),
    "settlement ledger credit visible through user session",
  ).toBeTruthy();

  await page.goto("/portfolio/", { waitUntil: "networkidle" });
  await assertNoNextError(page);
  await page.getByRole("tab", { name: /History/i }).click();
  await expect(page.getByText(/MLBB-FINAL-G1|MLBB/i).first()).toBeVisible();
  await expect(page.getByText(/\+?\d+(\.\d{2})? pts/i).first()).toBeVisible();

  await page.goto("/leaderboards/", { waitUntil: "domcontentloaded" });
  await assertNoNextError(page);
  await expect(page.getByText("Leaderboards").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Rankings/i })).toBeVisible();
  await expect(page.getByRole("row", { name: /You .* pts/i })).toBeVisible();

  await page.goto("/activity/", { waitUntil: "domcontentloaded" });
  await assertNoNextError(page);
  await expect(page.getByText(proofComment)).toBeVisible({ timeout: 15_000 });

  for (const path of [
    "/cashier",
    "/cashout",
    "/crypto",
    "/deposit",
    "/withdraw",
    "/redeem",
  ]) {
    const res = await page.goto(path, { waitUntil: "domcontentloaded" });
    expect(res?.status() ?? 0, `${path} absent from player routes`).toBe(404);
  }
});
