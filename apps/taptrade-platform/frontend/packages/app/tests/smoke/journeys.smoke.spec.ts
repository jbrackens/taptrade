import { test, expect, captureConsoleErrors,
  openTradeTicket,
} from "./_shared";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * E2E user journeys (2026-07-12 store + audit pass).
 *
 * J1  browse markets (demo user, read-only)
 * J2  prediction with sufficient points (fresh user funded via the store)
 * J3  insufficient points → store entry with market context preserved
 * J4  successful pack purchase (exact credit, ledger rows, persistence)
 * J5  failed + canceled purchases credit nothing (+ delayed pending flow)
 * J6  duplicate confirmation is idempotent
 * J7  narrow-viewport store layout (320px) — and the whole file also runs
 *     under the mobile-chromium project (375x812) like every smoke spec.
 *
 * A single fresh account per project run is provisioned through the real
 * registration API (the auth service rate-limits registrations, so tests
 * share it via a saved storageState). Money assertions are API-verified
 * (wallet balance + ledger rows through the same-origin proxy with the
 * browser context's cookies) — never UI text alone.
 *
 * Console-error capture allows exactly one known local-topology artifact:
 * `next start` has no /ws proxy, so the WebSocket client falls back to
 * ws://localhost:18080/ws which the CSP (connect-src 'self') blocks. The
 * deployed edge proxies /ws same-origin, where the CSP permits it. Live
 * frames are an enhancement layer — pages fully function without them.
 */

const WS_CSP_LOCAL_ARTIFACT =
  /Content Security Policy|ws:\/\/localhost:18080\/ws/;

const TERMS = {
  terms_accepted: true,
  terms_version: "taptrade-launch-v1",
  launch_disclosure_accepted: true,
  launch_disclosure_version: "points-no-cashout-v1",
};
const PASSWORD = "E2eJourney12345!";
// Open, SMM-liquid order-book market from the demo seed; a fallback is
// discovered via the API if this one has closed.
const LIQUID_TICKER = "IMP-3A9130E3";

const AUTH_DIR = path.join(__dirname, ".auth");
function arcStatePath(projectName: string): string {
  return path.join(AUTH_DIR, `journeys-${projectName}.json`);
}
function arcUserPath(projectName: string): string {
  return path.join(AUTH_DIR, `journeys-${projectName}-user.json`);
}
function loadArcUser(projectName: string): { userId: string } {
  return JSON.parse(readFileSync(arcUserPath(projectName), "utf-8")) as {
    userId: string;
  };
}

interface WalletBalance {
  balancePoints: number;
}
interface LedgerEntry {
  type: string;
  amountPoints: number;
  idempotencyKey: string;
  reason?: string;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Register + login with retry on the auth service's rate limiter. */
async function registerAndLogin(
  context: BrowserContext,
  tag: string,
): Promise<{ userId: string; username: string }> {
  const req = context.request;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const username = `e2e-${tag}-${Date.now()}@journeys.local`;
    const reg = await req.post("/api/v1/auth/register/", {
      data: { username, password: PASSWORD, email: username, ...TERMS },
    });
    lastStatus = reg.status();
    if (reg.status() === 429) {
      await sleep(20_000);
      continue;
    }
    expect(reg.ok(), `register ${username}: ${reg.status()}`).toBeTruthy();
    const regBody = (await reg.json()) as { userId: string };
    const login = await req.post("/api/v1/auth/login/", {
      data: { username, password: PASSWORD },
    });
    expect(login.ok(), `login ${username}: ${login.status()}`).toBeTruthy();
    return { userId: regBody.userId, username };
  }
  throw new Error(
    `registration rate-limited after retries (last ${lastStatus})`,
  );
}

async function csrfHeader(
  context: BrowserContext,
): Promise<Record<string, string>> {
  const cookies = await context.cookies();
  const csrf = cookies.find((c) => c.name === "csrf_token");
  return csrf ? { "X-CSRF-Token": csrf.value } : {};
}

async function apiBalance(
  req: APIRequestContext,
  userId: string,
): Promise<number> {
  const res = await req.get(`/api/v1/wallet/${userId}/`);
  expect(res.ok(), `wallet read: ${res.status()}`).toBeTruthy();
  return ((await res.json()) as WalletBalance).balancePoints;
}

async function apiLedger(
  req: APIRequestContext,
  userId: string,
): Promise<LedgerEntry[]> {
  const res = await req.get(`/api/v1/wallet/${userId}/ledger/?limit=100`);
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { items: LedgerEntry[] }).items ?? [];
}

function storeRows(items: LedgerEntry[], purchaseId?: string): LedgerEntry[] {
  return items.filter(
    (e) =>
      e.idempotencyKey?.startsWith("store_purchase:") &&
      (!purchaseId || e.idempotencyKey.includes(purchaseId)),
  );
}

async function openLiquidMarket(page: Page): Promise<string> {
  let ticker = LIQUID_TICKER;
  const res = await page.request.get(`/api/v1/markets/${LIQUID_TICKER}/`);
  if (res.ok()) {
    const m = (await res.json()) as { status?: string };
    if (m.status !== "open") ticker = "";
  } else {
    ticker = "";
  }
  if (!ticker) {
    const list = await page.request.get(
      "/api/v1/markets/?status=open&pageSize=20&sort=activity",
    );
    expect(list.ok()).toBeTruthy();
    const body = (await list.json()) as {
      data: Array<{ ticker: string; executionMode?: string }>;
    };
    const candidate = body.data.find(
      (m) => (m.executionMode ?? "order_book") === "order_book",
    );
    expect(candidate, "no open order_book market found").toBeTruthy();
    ticker = candidate!.ticker;
  }
  await page.goto(`/market/${ticker}/`);
  // Readiness: ticket tabs on desktop; on the <=1023px band the ticket
  // is sheeted (P3) and the fixed trade CTA is the readiness signal.
  // (Polled pair, not .or().first(): the union resolves in DOM order and
  // would pick the CSS-hidden sheet trigger on desktop.)
  await expect
    .poll(
      async () => {
        const tabs = await page
          .getByText(/Buy YES|Buy NO/i)
          .first()
          .isVisible()
          .catch(() => false);
        if (tabs) return true;
        return page
          .getByTestId("open-trade-sheet")
          .isVisible()
          .catch(() => false);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return ticker;
}

/** From /store (already open or navigated): select pack → summary → outcome. */
async function buyPack(
  page: Page,
  packId: string,
  outcome: "pay" | "fail" | "cancel" | "delay",
  opts: { navigate?: boolean } = {},
): Promise<void> {
  if (opts.navigate !== false) await page.goto("/store/");
  // Let the store page settle (auth resolution + packs fetch) before
  // interacting — a click during a late re-render can be clobbered.
  await expect(page.getByTestId(`pack-card-${packId}`)).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByTestId(`pack-card-${packId}`).click();
  await expect(page.getByTestId("order-summary")).toBeVisible();
  const [checkoutResp] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes("/api/v1/store/checkout") &&
        r.request().method() === "POST",
      { timeout: 15_000 },
    ),
    page
      .getByTestId("store-continue")
      .click({ timeout: 5_000 })
      .catch(() =>
        page
          .getByTestId("store-continue")
          .evaluate((el) => (el as HTMLElement).click()),
      ),
  ]);
  expect(checkoutResp.status(), "checkout POST status").toBe(201);
  await page.waitForURL(/purchase=sp_/, { timeout: 10_000 });
  const btn = page.getByTestId(`checkout-${outcome}`);
  await expect(btn).toBeVisible({ timeout: 10_000 });
  await btn.click();
}

// ---------------------------------------------------------------------------
// J1 — Browse markets (demo storageState; read-only)
// ---------------------------------------------------------------------------
test.describe("J1 browse markets", () => {
  test("home renders clean, Moments filters browse, market detail", async ({
    page,
  }) => {
    const assertNoConsoleErrors = captureConsoleErrors(page, {
      allow: [WS_CSP_LOCAL_ARTIFACT],
    });

    await page.goto("/");
    await expect(
      page.getByRole("link", { name: /browse/i }).first(),
    ).toBeVisible();

    // domcontentloaded, not load: Firefox starves the load event on the
    // dev server (many parallel compile-time responses hold Gecko's
    // connection pool open past the 30s timeout). The visibility
    // assertions below are the real readiness gate on every engine.
    await page.goto("/predict/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("market-card").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole("button", { name: /\d+% buy yes/i }).first(),
    ).toBeVisible();
    const closingSoon = page.getByTestId("market-sort-closing_soon");
    await closingSoon.click();
    await expect(closingSoon).toHaveAttribute("aria-pressed", "true");
    const oneWeek = page.getByTestId("market-window-7d");
    await oneWeek.click();
    await expect(oneWeek).toHaveAttribute("aria-pressed", "true");

    const ticker = await openLiquidMarket(page);
    expect(ticker).toBeTruthy();
    await expect(page.getByText(/\d+\s*pts\b/i).first()).toBeVisible();
    await expect(page.getByText(/prob/i).first()).toBeVisible();
    await expect(page.getByText(/Closes|Closed|close/i).first()).toBeVisible();

    assertNoConsoleErrors();
  });
});

// ---------------------------------------------------------------------------
// J7 — Narrow store layout (demo storageState; read-only)
// ---------------------------------------------------------------------------
test("J7 store single-columns at 320px without horizontal scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 680 });

  // In CI the lightweight Next dev server can occasionally serve an empty
  // route manifest while compiling a page after a prior serial retry. Retry
  // this narrow navigation, but still require an actual store card before
  // measuring layout so a persistent route failure remains visible.
  await expect(async () => {
    const response = await page.goto("/store/", {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status(), "store document status").toBe(200);
    const packGrid = page.getByRole("group", { name: /point packs/i });
    await expect(packGrid).toBeVisible({ timeout: 6_000 });
    await expect(packGrid.locator('[data-testid^="pack-card-"]').first()).toBeVisible({
      timeout: 6_000,
    });
  }).toPass({ timeout: 20_000 });

  const layout = await page.getByRole("group", { name: /point packs/i }).evaluate((grid) => {
    const el = document.scrollingElement ?? document.documentElement;
    return {
      columns: getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length,
      overflow: el.scrollWidth - el.clientWidth,
    };
  });
  expect(layout.columns, "store grid columns at 320px").toBe(1);
  expect(layout.overflow, "horizontal overflow px").toBeLessThanOrEqual(1);
});

// ---------------------------------------------------------------------------
// Arc provisioning — one fresh user per project run, persisted storageState
// ---------------------------------------------------------------------------
test.describe("arc user provisioning", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("register fresh journey user (0 points)", async ({
    page,
    context,
  }, testInfo) => {
    mkdirSync(AUTH_DIR, { recursive: true });
    const who = await registerAndLogin(context, testInfo.project.name);
    // Fresh accounts start at 0 via the API — but the app auto-claims the
    // starter grant (option B: 1,000 pts) on first UI login, so later
    // journeys derive "insufficient" from the LIVE balance, never from an
    // assumed zero.
    expect(await apiBalance(page.request, who.userId)).toBe(0);
    await context.storageState({ path: arcStatePath(testInfo.project.name) });
    writeFileSync(
      arcUserPath(testInfo.project.name),
      JSON.stringify({ userId: who.userId }),
    );
  });
});

// ---------------------------------------------------------------------------
// J3 → J4 → J2 → J5 → J6 — store + trading arc (serial, shared fresh user)
// ---------------------------------------------------------------------------
test.describe("store + trading journeys (fresh user)", () => {
  test.describe.configure({ mode: "serial" });

  let marketPath = "";

  // Each test creates its context from the provisioned storageState file.
  test.beforeEach(async ({ context }, testInfo) => {
    const state = arcStatePath(testInfo.project.name);
    expect(
      existsSync(state),
      "arc user provisioning must run first",
    ).toBeTruthy();
    const cookies = (
      JSON.parse(readFileSync(state, "utf-8")) as {
        cookies: Parameters<BrowserContext["addCookies"]>[0];
      }
    ).cookies;
    await context.clearCookies();
    await context.addCookies(cookies);
  });
  test.use({ storageState: { cookies: [], origins: [] } });
  // Persist rotated cookies back for the next test in the arc (the auth
  // service rotates refresh tokens; a stale file kills the session chain).
  test.afterEach(async ({ context }, testInfo) => {
    await context.storageState({ path: arcStatePath(testInfo.project.name) });
  });

  test("J3 insufficient points routes to the store with market context", async ({
    page,
  }, testInfo) => {
    const { userId } = loadArcUser(testInfo.project.name);

    const ticker = await openLiquidMarket(page);
    marketPath = `/market/${ticker}/`;

    // The page load may auto-claim the starter grant; ask for more points
    // than the CURRENT balance can cover so the insufficient state is
    // guaranteed regardless of faucet configuration.
    const bal = await apiBalance(page.request, userId);
    await openTradeTicket(page);
    const amount = page
      .locator('input[inputmode="numeric"], input[type="number"]')
      .first();
    await amount.fill(String(bal + 1000));
    await expect(page.getByText(/not enough points/i).first()).toBeVisible({
      timeout: 10_000,
    });
    const cta = page.getByTestId("add-points-tradeticket");
    await expect(cta).toBeVisible();
    await cta
      .click({ timeout: 5_000 })
      .catch(() => cta.evaluate((el) => (el as HTMLElement).click()));
    await expect(page).toHaveURL(/\/store\/?\?.*return=/, { timeout: 10_000 });
    expect(decodeURIComponent(page.url())).toContain(
      marketPath.replace(/\/$/, ""),
    );
  });

  test("J4 successful purchase credits exactly once, persists, returns to market", async ({
    page,
  }, testInfo) => {
    const { userId } = loadArcUser(testInfo.project.name);
    const before = await apiBalance(page.request, userId);

    // Fail fast and loud if the serial-chain module state didn't survive
    // (an empty marketPath makes goto("") resolve to baseURL — the landing
    // page — and the amount-input wait then times out uninformatively).
    expect(marketPath, "marketPath must be set by J3 in this worker").toMatch(
      /^\/market\//,
    );

    // Enter through the ticket CTA so the return context is real.
    await page.goto(marketPath);
    const balNow = await apiBalance(page.request, userId);
    await openTradeTicket(page);
    const amount = page
      .locator('input[inputmode="numeric"], input[type="number"]')
      .first();
    await amount.fill(String(balNow + 1000));
    const cta = page.getByTestId("add-points-tradeticket");
    await expect(cta).toBeVisible({ timeout: 10_000 });
    await cta
      .click({ timeout: 5_000 })
      .catch(() => cta.evaluate((el) => (el as HTMLElement).click()));
    await expect(page).toHaveURL(/\/store\/?\?.*return=/, { timeout: 10_000 });

    await buyPack(page, "popular", "pay", { navigate: false });
    await expect(page.getByTestId("purchase-success")).toBeVisible({
      timeout: 15_000,
    });
    const purchaseId =
      new URL(page.url()).searchParams.get("purchase") ??
      page.url().match(/sp_[A-Za-z0-9]+/)?.[0] ??
      "";
    expect(purchaseId, `purchase id from ${page.url()}`).toMatch(/^sp_/);

    // Exact credit: popular = 2,500 base + 250 bonus.
    await expect
      .poll(async () => apiBalance(page.request, userId), { timeout: 10_000 })
      .toBe(before + 2750);
    // Scope ledger assertions to this checkout. Playwright retries a serial
    // describe from the first test after a later failure, so a successful
    // earlier attempt can legitimately have its own immutable ledger rows.
    const rows = storeRows(await apiLedger(page.request, userId), purchaseId);
    const purchases = rows.filter((r) => r.reason === "point_pack_purchase");
    const bonuses = rows.filter((r) => r.reason === "promo_bonus");
    expect(purchases.length).toBe(1);
    expect(bonuses.length).toBe(1);
    expect(purchases[0].amountPoints).toBe(2500);
    expect(bonuses[0].amountPoints).toBe(250);

    // Balance survives reload; return context leads back to the market.
    await page.reload();
    await expect(page.getByTestId("purchase-success")).toBeVisible({
      timeout: 15_000,
    });
    expect(await apiBalance(page.request, userId)).toBe(before + 2750);
    const back = page.getByTestId("return-to-market");
    await expect(back).toBeVisible();
    await back.click();
    await expect(page).toHaveURL(
      new RegExp(marketPath.replace(/[/[\]]/g, "\\$&")),
    );

    // Ledger rows appear in transaction history UI.
    await page.goto("/account/transactions/");
    await expect(page.getByText(/point pack/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("J2 prediction with sufficient points — deduction + position", async ({
    page,
  }, testInfo) => {
    const { userId } = loadArcUser(testInfo.project.name);
    const before = await apiBalance(page.request, userId);
    expect(before).toBeGreaterThanOrEqual(1000);

    await page.goto(marketPath);
    await openTradeTicket(page);
    const amount = page
      .locator('input[inputmode="numeric"], input[type="number"]')
      .first();
    await amount.fill("200");
    // Exercise the production press-and-hold interaction. A delayed
    // locator click can release just before an under-load rAF reaches the
    // hold threshold, so keep a real pointer down with enough slack.
    const submit = page.getByRole("button", { name: /^hold to place\b/i });
    await expect(submit).toBeEnabled({ timeout: 10_000 });
    const orderResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.status() === 201 &&
        /^\/api\/v1\/orders\/?$/.test(new URL(response.url()).pathname),
      { timeout: 15_000 },
    );
    await submit.hover();
    await page.mouse.down();
    try {
      await expect(
        page.getByRole("button", { name: /^holding… keep pressing$/i }),
      ).toBeVisible({ timeout: 2_000 });
      await page.waitForTimeout(1_250);
      await orderResponse;
    } finally {
      await page.mouse.up();
    }

    await expect
      .poll(async () => before - (await apiBalance(page.request, userId)), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
    const spent = before - (await apiBalance(page.request, userId));
    expect(spent).toBeLessThanOrEqual(200);

    const ledger = await apiLedger(page.request, userId);
    const orderMoves = ledger.filter(
      (e) =>
        e.idempotencyKey?.includes("prediction_") ||
        e.idempotencyKey?.startsWith("reservation:prediction_order:"),
    );
    expect(orderMoves.length).toBeGreaterThan(0);

    await page.goto("/portfolio/");
    await expect(page.getByText(/World Cup|position/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("J5 failed and canceled purchases credit nothing", async ({
    page,
  }, testInfo) => {
    const { userId } = loadArcUser(testInfo.project.name);
    const before = await apiBalance(page.request, userId);

    await buyPack(page, "player", "fail");
    await expect(page.getByTestId("purchase-failed")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole("button", { name: /try again|retry/i }).first(),
    ).toBeVisible();
    expect(await apiBalance(page.request, userId)).toBe(before);

    await buyPack(page, "player", "cancel");
    await expect(page.getByTestId("purchase-canceled")).toBeVisible({
      timeout: 15_000,
    });
    expect(await apiBalance(page.request, userId)).toBe(before);
  });

  test("J6 duplicate confirmation cannot double-credit", async ({
    page,
    context,
  }, testInfo) => {
    const { userId } = loadArcUser(testInfo.project.name);
    const before = await apiBalance(page.request, userId);

    await page.goto("/store/");
    await expect(page.getByTestId("pack-card-starter")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.getByTestId("pack-card-starter").click();
    await expect(page.getByTestId("order-summary")).toBeVisible();
    const [checkoutResp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/v1/store/checkout") &&
          r.request().method() === "POST",
        { timeout: 15_000 },
      ),
      page
        .getByTestId("store-continue")
        .click({ timeout: 5_000 })
        .catch(() =>
          page
            .getByTestId("store-continue")
            .evaluate((el) => (el as HTMLElement).click()),
        ),
    ]);
    expect(checkoutResp.status()).toBe(201);
    await page.waitForURL(/purchase=sp_/, { timeout: 10_000 });
    const pay = page.getByTestId("checkout-pay");
    await expect(pay).toBeVisible({ timeout: 10_000 });
    // Two synchronous DOM clicks — the UI disables the button on the first
    // (double-submit protection), so a second Playwright click would hang on
    // actionability. Server idempotency is separately proven by the API
    // replay below.
    await pay.evaluate((el: HTMLButtonElement) => {
      el.click();
      el.click();
    });
    await expect(page.getByTestId("purchase-success")).toBeVisible({
      timeout: 15_000,
    });
    await expect
      .poll(async () => apiBalance(page.request, userId), { timeout: 10_000 })
      .toBe(before + 500);

    const url = new URL(page.url());
    const purchaseId =
      url.searchParams.get("purchase") ??
      page.url().match(/sp_[A-Za-z0-9]+/)?.[0] ??
      "";
    expect(purchaseId, `purchase id from ${page.url()}`).toMatch(/^sp_/);
    const replay = await context.request.post(
      `/api/v1/store/purchases/${purchaseId}/confirm/`,
      { data: { outcome: "success" }, headers: await csrfHeader(context) },
    );
    expect(replay.ok(), `replay status ${replay.status()}`).toBeTruthy();
    const replayBody = (await replay.json()) as { alreadyFulfilled?: boolean };
    expect(replayBody.alreadyFulfilled).toBe(true);

    expect(await apiBalance(page.request, userId)).toBe(before + 500);
    const rows = storeRows(await apiLedger(page.request, userId), purchaseId);
    expect(rows.length).toBe(1); // starter has no bonus row
  });

  test("J5b delayed purchase stays pending, then completes exactly once", async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    const { userId } = loadArcUser(testInfo.project.name);
    const before = await apiBalance(page.request, userId);

    await buyPack(page, "player", "delay");
    await expect(page.getByTestId("purchase-pending")).toBeVisible({
      timeout: 15_000,
    });
    // Pending purchases hold zero spendable points.
    expect(await apiBalance(page.request, userId)).toBe(before);
    // Completes ~10s after creation via status polling.
    await expect(page.getByTestId("purchase-success")).toBeVisible({
      timeout: 30_000,
    });
    await expect
      .poll(async () => apiBalance(page.request, userId), { timeout: 10_000 })
      .toBe(before + 1050);
  });

});
