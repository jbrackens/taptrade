import { chromium } from 'playwright';

const ROOT = '/Users/john/Sandbox/taptrade-workspace/nimbus_deck/v2/img';

const PLAYER_PAGES = [
  ['discover', 'http://localhost:3000/discover'],
  ['predict', 'http://localhost:3000/predict'],
  ['cat-politics', 'http://localhost:3000/category/politics'],
  ['cat-crypto', 'http://localhost:3000/category/crypto'],
  ['cat-sports', 'http://localhost:3000/category/sports'],
  ['portfolio', 'http://localhost:3000/portfolio'],
  ['leaderboards', 'http://localhost:3000/leaderboards'],
  ['rewards', 'http://localhost:3000/rewards'],
];

async function loginPlayer(context) {
  // call auth API directly — sets cookies on this context
  const resp = await context.request.post('http://localhost:18081/api/v1/auth/login', {
    data: { username: 'demo@taptrade.local', password: 'demo123' },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!resp.ok()) throw new Error(`player login failed ${resp.status()}`);
}

async function loginOffice(context) {
  // backoffice should accept admin@taptrade.local / admin123 — try both shapes
  const tries = [
    { username: 'admin@taptrade.local', password: 'admin123' },
    { email: 'admin@taptrade.local', password: 'admin123' },
  ];
  for (const body of tries) {
    const resp = await context.request.post('http://localhost:18081/api/v1/auth/login', {
      data: body,
      headers: { 'Content-Type': 'application/json' },
    });
    if (resp.ok()) return;
  }
  throw new Error('office login failed');
}

async function snap(page, name, opts = {}) {
  const fp = `${ROOT}/${name}.png`;
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(opts.wait ?? 800);
  await page.screenshot({ path: fp, fullPage: opts.fullPage ?? false });
  console.log(`  → ${name}.png`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ---- Player app — desktop ----
  const playerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await loginPlayer(playerCtx);
  const page = await playerCtx.newPage();
  for (const [name, url] of PLAYER_PAGES) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await snap(page, `player-${name}`);
    } catch (e) {
      console.log(`  ✗ ${name}: ${e.message}`);
    }
  }
  // also capture the Senate market detail (used in trade ticket slide)
  try {
    await page.goto('http://localhost:3000/market/SENATE-DEM-2026', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await snap(page, 'player-market-detail');
  } catch (e) {
    console.log(`  ✗ market-detail: ${e.message}`);
  }

  // ---- Player app — mobile ----
  const mobileCtx = await browser.newContext({
    viewport: { width: 390, height: 844 }, // iPhone 14
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  await loginPlayer(mobileCtx);
  const mpage = await mobileCtx.newPage();
  for (const url of [
    ['mobile-discover', 'http://localhost:3000/discover'],
    ['mobile-predict', 'http://localhost:3000/predict'],
    ['mobile-portfolio', 'http://localhost:3000/portfolio'],
    ['mobile-market', 'http://localhost:3000/market/SENATE-DEM-2026'],
  ]) {
    try {
      await mpage.goto(url[1], { waitUntil: 'domcontentloaded', timeout: 20000 });
      await snap(mpage, `player-${url[0]}`);
    } catch (e) {
      console.log(`  ✗ ${url[0]}: ${e.message}`);
    }
  }

  // ---- Back office ----
  const officeCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  try {
    await loginOffice(officeCtx);
  } catch (e) {
    console.log(`office login: ${e.message}`);
  }
  const opage = await officeCtx.newPage();
  for (const [name, url] of [
    ['office-root', 'http://localhost:3001/'],
    ['office-predict-markets', 'http://localhost:3001/prediction-admin/markets'],
    ['office-predict-settlements', 'http://localhost:3001/prediction-admin/settlements'],
    ['office-dashboard', 'http://localhost:3001/dashboard'],
    ['office-trading', 'http://localhost:3001/trading'],
    ['office-users', 'http://localhost:3001/users'],
    ['office-audit', 'http://localhost:3001/audit-logs'],
  ]) {
    try {
      await opage.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await snap(opage, name);
    } catch (e) {
      console.log(`  ✗ ${name}: ${e.message}`);
    }
  }

  await browser.close();
  console.log('Done.');
})();
