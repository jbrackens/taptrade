import {
  test,
  expect,
  assertPageHealthy,
  captureConsoleErrors,
  openTradeTicket,
} from "./_shared";

test.describe("/market/[ticker] — market detail", () => {
  test("first seeded market renders chart + trade ticket", async ({ page }) => {
    const checkErrors = captureConsoleErrors(page);

    // Discover a real seeded ticker rather than hardcoding one. If seed
    // changes, the test shouldn't break.
    const discoveryResponse = await page.request.get("/api/v1/discovery");
    expect(
      discoveryResponse.ok(),
      `/api/v1/discovery returned ${discoveryResponse.status()}`,
    ).toBe(true);

    const discovery = (await discoveryResponse.json()) as {
      featured?: Array<{ ticker?: string }>;
      trending?: Array<{ ticker?: string }>;
    };
    const firstTicker =
      discovery.featured?.[0]?.ticker ?? discovery.trending?.[0]?.ticker;

    if (!firstTicker) {
      test.skip(
        true,
        "No seeded markets returned from /api/v1/discovery — skipping smoke",
      );
      return;
    }

    await assertPageHealthy(page, `/market/${firstTicker}`);
    await openTradeTicket(page);

    // Market details are part of the same trading workspace as the market
    // directory, not the legacy padded shell.
    await expect(page.locator(".predict-terminal")).toHaveCount(1);
    await expect(
      page.locator('section[aria-label="Trade ticket"]'),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
      "market detail should not overflow horizontally",
    ).toBe(true);

    // Market question renders — the market head card prints the question
    // as the largest text on the page.
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 10_000 });

    // YES and NO prices are both rendered somewhere on the page, in
    // points (Kilig copy rule: "44 pts", never "44¢").
    await expect(page.getByText(/\d+\s*pts\b/i).first()).toBeVisible();
    await expect(page.getByText(/\d+¢/)).toHaveCount(0);

    // Trade ticket exists — we match the "Review trade" CTA text since the
    // component structure is redesigned in Phase 3.
    const ticketCta = page.getByRole("button", {
      name: /review|place|confirm|buy|yes|no/i,
    });
    await expect(ticketCta.first()).toBeVisible({ timeout: 10_000 });

    checkErrors();
  });

  test("share dialog exercises the ui/Dialog primitive with shared surface tokens", async ({
    page,
  }, testInfo) => {
    // On fine-pointer (desktop) devices the ui/Dialog IS the product's
    // share flow — no API stubbing needed. Touch projects legitimately
    // get the native share sheet instead, so they skip. This is the
    // exercised-Dialog gate from the P1 re-review: the popup PORTALS into
    // document.body (outside .predict-terminal) and must still resolve
    // the shared light surface tokens used by the current brand system.
    test.skip(
      testInfo.project.name.includes("mobile"),
      "touch devices use the native share sheet by design",
    );
    const discoveryResponse = await page.request.get("/api/v1/discovery");
    const discovery = (await discoveryResponse.json()) as {
      featured?: Array<{ ticker?: string }>;
      trending?: Array<{ ticker?: string }>;
    };
    const ticker =
      discovery.featured?.[0]?.ticker ?? discovery.trending?.[0]?.ticker;
    if (!ticker) {
      test.skip(true, "No seeded markets — skipping share dialog smoke");
      return;
    }

    await page.goto(`/market/${ticker}`);
    await page.getByTestId("share-market").click();

    const dialog = page.getByTestId("share-dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // The link field carries the market URL.
    await expect(page.getByTestId("share-link")).toHaveValue(
      new RegExp(`/market/${ticker}`),
    );

    // The portalled popup resolves the shared light card surface, rather
    // than relying on a retired route-specific terminal theme.
    const popupBg = await dialog.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(popupBg, "portalled dialog must resolve light surface tokens").toBe(
      "rgb(255, 255, 255)",
    );

    // The dialog is a real Base UI dialog: Escape dismisses it.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden({ timeout: 5_000 });
  });

  test.describe("unauthenticated trade ticket", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("public market page stays console-clean and keeps selected quick amount", async ({
      page,
    }) => {
      const checkErrors = captureConsoleErrors(page);

      const discoveryResponse = await page.request.get("/api/v1/discovery");
      expect(
        discoveryResponse.ok(),
        `/api/v1/discovery returned ${discoveryResponse.status()}`,
      ).toBe(true);

      const discovery = (await discoveryResponse.json()) as {
        featured?: Array<{ ticker?: string }>;
        trending?: Array<{ ticker?: string }>;
      };
      const firstTicker =
        discovery.featured?.[0]?.ticker ?? discovery.trending?.[0]?.ticker;

      if (!firstTicker) {
        test.skip(
          true,
          "No seeded markets returned from /api/v1/discovery — skipping smoke",
        );
        return;
      }

      await assertPageHealthy(page, `/market/${firstTicker}`);
      await openTradeTicket(page);

      // Regression: ISSUE-001 — the amount control displayed $0.00 when
      // balance was zero because it clamped to the user's balance.
      // Found by /qa on 2026-04-25.
      // Report: qa-report-localhost-3000-2026-04-25.md (gstack QA report; removed from the repo in the 2026-09-06 docs sweep)
      // (2026-07-12: the Phase-3 quick-amount chips were later replaced by a
      // plain amount input; the regression contract is unchanged — a typed
      // amount must survive a zero balance while logged out.)
      const signUp = page.getByRole("link", {
        name: "Sign up to place this trade",
      });
      await expect(signUp).toBeVisible();
      await expect(signUp).toHaveAttribute(
        "href",
        /^\/auth\/register\/?\?returnUrl=/,
      );
      const amountInput = page.locator("#ticket-amount");
      await amountInput.fill("100");
      await expect(amountInput).toHaveValue("100");
      await expect(signUp).toBeVisible();
      const signIn = page.getByRole("link", {
        name: /Sign in to place this (YES|NO) order/,
      });
      await expect(signIn).toBeVisible();
      await expect(signIn).toHaveAttribute(
        "href",
        /^\/auth\/login\/?\?returnUrl=/,
      );

      checkErrors();
    });

    test("invalid market ticker shows recovery UI with only the expected 404 noise", async ({
      page,
    }) => {
      const ticker = "NOT-A-REAL-MARKET";
      const checkErrors = captureConsoleErrors(page, {
        allow: [
          `/api/v1/markets/${ticker}`,
          (text) =>
            text.includes("Failed to load resource") && text.includes("404"),
        ],
      });
      const marketNotFound = page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/markets/${ticker}`) &&
          response.status() === 404,
      );

      const response = await page.goto(`/market/${ticker}`, {
        waitUntil: "domcontentloaded",
      });

      expect(response?.ok(), `/market/${ticker} route should render`).toBe(
        true,
      );
      await marketNotFound;
      await expect(page.getByText("Market unavailable")).toBeVisible({
        timeout: 10_000,
      });
      await expect(
        page.getByRole("heading", { name: /couldn't open that market/i }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Back to Markets" }),
      ).toBeVisible();

      checkErrors();
    });
  });
});
