# Sportsbook-Era E2E Test Suites

> Historical sportsbook-era note: these suites and selectors document the
> pre-migration sportsbook app. They are not the current prediction-market QA
> contract unless a spec has been explicitly rewritten against Tap Trade routes,
> prediction orders, and portfolio/accounting APIs.

Comprehensive Playwright E2E tests for both the sportsbook-era Player App and
Backoffice admin interface.

## Quick Start

### Prerequisites

- Node.js >= 20
- Yarn >= 1.22.22
- Playwright dependencies installed

### Run Tests

```bash
# All tests
npx playwright test

# Player app only
npx playwright test --project=player-app

# Backoffice only
npx playwright test --project=backoffice

# Responsive tests (mobile/tablet)
npx playwright test --project=player-app-mobile
npx playwright test --project=player-app-tablet

# UI mode (interactive)
npx playwright test --ui

# Debug mode
npx playwright test --debug

# Generate HTML report
npx playwright show-report
```

## Test Structure

```
e2e/
├── player-app/                    # Player App E2E Tests
│   ├── auth.spec.ts              # Authentication flows
│   ├── browse-sports.spec.ts      # Sports browsing & discovery
│   ├── match-detail.spec.ts       # Match detail page & markets
│   ├── betslip.spec.ts            # Betting slip & bet placement
│   ├── bet-history.spec.ts        # Bet history & filtering
│   └── responsive.spec.ts         # Mobile/tablet responsiveness
│
├── backoffice/                     # Backoffice E2E Tests
│   ├── auth.spec.ts              # Admin authentication
│   ├── dashboard.spec.ts          # Dashboard & widgets
│   ├── trading.spec.ts            # Trading & market management
│   ├── user-management.spec.ts    # User administration
│   └── audit-logs.spec.ts         # Audit trail & logging
│
├── fixtures/                       # Shared Test Helpers
│   ├── test-data.ts               # Test data & fixtures
│   ├── auth.ts                    # Login/logout helpers
│   └── api-mock.ts                # API route interceptors
│
├── .auth/                          # Stored authentication states
│   ├── admin.json                 # Admin session state
│   └── player.json                # Player session state
│
└── README.md                       # This file
```

## Test Suites

### Player App Tests

#### 1. Authentication (`auth.spec.ts`)

- Login flow with credential validation
- Protected route access (redirects to login)
- Session persistence across page refreshes
- Logout and session cleanup
- Invalid credential error handling
- Token refresh during active session

**Key Selectors:**

- `[data-testid="login-username"]` - Username input
- `[data-testid="login-password"]` - Password input
- `[data-testid="login-submit"]` - Submit button
- `[data-testid="user-menu"]` - User profile menu
- `[data-testid="logout-button"]` - Logout button

#### 2. Browse Sports (`browse-sports.spec.ts`)

- Featured matches visibility
- Live section with badge indicators
- Sport filtering via sidebar
- League filtering
- Match card display (team names, scores, status)
- Fixture list pagination/infinite scroll

**Key Selectors:**

- `[data-testid="featured-matches"]` - Featured section
- `[data-testid="live-section"]` - Live matches section
- `[data-testid="live-badge"]` - Live badge indicator
- `[data-testid="sport-filter"]` - Sport selection
- `[data-testid="league-filter"]` - League filter
- `[data-testid="fixture-card"]` - Match card
- `[data-testid="match-card"]` - Alternative match card selector
- `[data-testid="team-name"]` - Team name display

#### 3. Match Detail (`match-detail.spec.ts`)

- Navigate to match detail page
- Display match header with teams and time
- Market sections visibility
- Expandable/collapsible markets
- Selections with odds buttons
- Adding selections to betslip
- Live score display

**Key Selectors:**

- `[data-testid="match-header"]` - Match header
- `[data-testid="home-team-name"]` - Home team
- `[data-testid="away-team-name"]` - Away team
- `[data-testid="markets-section"]` - Markets container
- `[data-testid="market-title"]` - Market group title
- `[data-testid="market-expand"]` - Expand button
- `[data-testid="odds-button"]` - Odds selection button
- `[data-testid="selection-button"]` - Alternative odds button
- `[data-testid="live-badge"]` - Live status indicator

#### 4. Betslip (`betslip.spec.ts`)

- Add single selection to betslip
- Add multiple selections (parlay/accumulator)
- Stake entry and potential return calculation
- Single vs parlay bet mode toggle
- Remove individual legs
- Place bet and confirmation
- Quick stake buttons ($5, $10, $25, $50, $100)
- Clear betslip

**Key Selectors:**

- `[data-testid="betslip"]` - Betslip container
- `[data-testid="selection-item"]` - Betslip leg
- `[data-testid="stake-input"]` - Stake input field
- `[data-testid="potential-return"]` - Potential return display
- `[data-testid="bet-type-toggle"]` - Single/Parlay toggle
- `[data-testid="remove-selection"]` - Remove leg button
- `[data-testid="place-bet-button"]` - Place bet button
- `[data-testid="quick-stake"]` - Quick stake buttons
- `[data-testid="clear-betslip"]` - Clear button

#### 5. Bet History (`bet-history.spec.ts`)

- Navigate to /bets page
- Bet list displays (ID, status, stake, returns)
- Filter by status (open, won, lost)
- Click bet to view detail
- Expandable bet legs
- Search/filter by bet ID
- Bet history pagination

**Key Selectors:**

- `[data-testid="bet-list"]` - Bets container
- `[data-testid="bet-item"]` - Individual bet
- `[data-testid="status-filter"]` - Status filter
- `[data-testid="bet-search"]` - Search input
- `[data-testid="bet-detail"]` - Detail view
- `[data-testid="bet-leg"]` - Leg information

#### 6. Responsive Design (`responsive.spec.ts`)

- Mobile (375x667): Sidebar collapse, bottom sheet betslip
- Mobile: Bottom navigation with Home, Sports, Bets, Account
- Tablet (768x1024): Responsive layout
- Desktop (1920x1080): Full layout with sidebars
- Viewport-specific layout changes

**Tested Viewports:**

- Mobile: 375x667 (iPhone SE)
- Tablet: 768x1024 (iPad)
- Desktop: 1920x1080 (Full HD)

### Backoffice Tests

#### 1. Admin Authentication (`auth.spec.ts`)

- Redirect to login when accessing /dashboard unauthenticated
- Login with admin credentials
- Verify admin sidebar navigation
- Admin sidebar navigation structure
- Logout and session cleanup
- Invalid credential error handling
- Session persistence across refreshes

**Key Selectors:**

- `[data-testid="auth-username"]` - Username input
- `[data-testid="auth-password"]` - Password input
- `[data-testid="admin-sidebar"]` - Navigation sidebar
- `[data-testid="nav-link"]` - Navigation links
- `[data-testid="admin-logout"]` - Logout button

#### 2. Dashboard (`dashboard.spec.ts`)

- Dashboard widget visibility (Revenue, Active Bets, Live Matches, Alerts)
- Revenue widget displays numeric values
- Active bets count display
- Live matches widget
- Alerts widget
- Click live matches → navigate to trading
- Widget auto-refresh
- Responsive layout
- Loading states

**Key Selectors:**

- `[data-testid="dashboard"]` - Dashboard container
- `[data-testid="revenue-widget"]` - Revenue widget
- `[data-testid="active-bets-widget"]` - Active bets widget
- `[data-testid="live-matches-widget"]` - Live matches widget
- `[data-testid="alerts-widget"]` - Alerts widget
- `[data-testid="last-update"]` - Last update timestamp

#### 3. Trading (`trading.spec.ts`)

- Fixture board loads with matches
- Click fixture → market management panel opens
- Market list display
- Toggle market suspension
- Click settle → settlement panel opens
- Settlement panel with selections
- Filter fixtures by sport
- Filter fixtures by status (live, scheduled, ended)
- Export trading data

**Key Selectors:**

- `[data-testid="trading-view"]` - Trading page container
- `[data-testid="fixture-board"]` - Fixture board
- `[data-testid="trading-fixture"]` - Fixture item
- `[data-testid="market-panel"]` - Market management panel
- `[data-testid="market-item"]` - Market in list
- `[data-testid="toggle-suspension"]` - Suspend button
- `[data-testid="settle-market"]` - Settle button
- `[data-testid="settlement-panel"]` - Settlement panel
- `[data-testid="sport-filter"]` - Sport filter
- `[data-testid="status-filter"]` - Status filter
- `[data-testid="export-button"]` - Export button

#### 4. User Management (`user-management.spec.ts`)

- Users page with search and table
- Search for user → results filter
- Click user row → detail page/modal
- User detail with tabs
- Suspend user with confirmation modal
- View user activity/history
- Table displays key columns (ID, email, status, balance)
- Filter users by status (active, suspended, banned)
- Bulk user selection
- User pagination

**Key Selectors:**

- `[data-testid="users-page"]` - Users page
- `[data-testid="users-table"]` - User table
- `[data-testid="user-search"]` - Search input
- `[data-testid="user-row"]` - User table row
- `[data-testid="user-detail"]` - Detail view
- `[data-testid="suspend-user"]` - Suspend button
- `[data-testid="user-status-filter"]` - Status filter
- `[data-testid="activity-tab"]` - Activity tab
- `[data-testid="pagination-next"]` - Next page button

#### 5. Audit Logs (`audit-logs.spec.ts`)

- Audit logs page loads with log table
- Table displays columns (timestamp, action, user, resource, result)
- Filter by action type
- Filter by date range
- Search logs by keyword
- Click log entry → detail expands
- Log detail displays full action info
- Export audit logs
- Log pagination
- Filter by user who performed action

**Key Selectors:**

- `[data-testid="logs-page"]` - Audit logs page
- `[data-testid="audit-logs"]` - Logs container
- `[data-testid="log-table"]` - Log table
- `[data-testid="log-entry"]` - Individual log entry
- `[data-testid="action-filter"]` - Action type filter
- `[data-testid="date-filter"]` - Date range filter
- `[data-testid="log-search"]` - Search input
- `[data-testid="log-detail"]` - Detail view
- `[data-testid="export-logs"]` - Export button
- `[data-testid="user-filter"]` - User filter

## Shared Test Helpers

### `fixtures/auth.ts`

Login/logout helper functions for both apps:

```typescript
import { loginAsPlayer, logoutPlayer } from "../fixtures/auth";

// In tests:
await loginAsPlayer(page);
await loginAsAdmin(page);
await logoutPlayer(page);
await logoutAdmin(page);
```

Functions:

- `loginAsPlayer(page, username?, password?)` - Login player
- `loginAsAdmin(page, username?, password?)` - Login admin
- `logoutPlayer(page)` - Logout player
- `logoutAdmin(page)` - Logout admin
- `isAuthenticated(page)` - Check if authenticated
- `getAuthToken(page)` - Get stored auth token

### `fixtures/test-data.ts`

Reusable test data and fixtures:

```typescript
import { TEST_FIXTURES } from "../fixtures/test-data";

// Access test data:
TEST_FIXTURES.admin; // Admin credentials
TEST_FIXTURES.player; // Player credentials
TEST_FIXTURES.sports; // Sample sports
TEST_FIXTURES.fixtures; // Sample matches
TEST_FIXTURES.markets; // Sample markets
TEST_FIXTURES.selections; // Sample odds
TEST_FIXTURES.bets; // Sample bets
TEST_FIXTURES.quickStakes; // [$5, $10, $25, $50, $100]
```

Also includes `BasePage` class for page object patterns.

### `fixtures/api-mock.ts`

Playwright route interceptors for mocking API responses:

```typescript
import { setupAllMocks, mockBetsAPI } from "../fixtures/api-mock";

// In tests:
await setupAllMocks(page); // Mock all APIs
await mockBetsAPI(page); // Mock specific API
await mockNetworkError(page, "..."); // Mock errors
```

Available mocks:

- `mockAuthAPI()` - Authentication endpoints
- `mockUserProfileAPI()` - User profile data
- `mockSportsAPI()` - Sports list
- `mockFixturesAPI()` - Matches/fixtures
- `mockMarketsAPI()` - Markets
- `mockSelectionsAPI()` - Odds/selections
- `mockBetsAPI()` - Betting operations
- `mockNetworkError()` - Simulate network failures
- `mockSlowResponse()` - Simulate slow API responses
- `setupAllMocks()` - Set up all mocks at once

## Configuration

### playwright.config.ts

Two main projects:

1. **Backoffice** (`--project=backoffice`)
   - Base URL: `http://localhost:3000`
   - Viewport: 1920x1080
   - Uses mock-server on port 3010
   - Uses office package on port 3000

2. **Player App** (`--project=player-app`)
   - Base URL: `http://localhost:3002`
   - Viewport: 1280x720
   - Connects to Go backend:
     - Gateway: `http://localhost:18080`
     - Auth: `http://localhost:18081`

### Environment Variables

Player App (.env):

```
NEXT_PUBLIC_API_ENDPOINT=http://localhost:18080
NEXT_PUBLIC_AUTH_ENDPOINT=http://localhost:18081
NEXT_PUBLIC_WS_ENDPOINT=ws://localhost:18080
```

Backoffice (.env):

```
API_GLOBAL_ENDPOINT=http://localhost:3010
WS_GLOBAL_ENDPOINT=ws://localhost:3010
```

## Best Practices

### Selector Priority

1. `[data-testid="..."]` - Preferred (explicit test IDs)
2. `[role="..."]` - Fallback for common patterns
3. `text=/.../"` - Fallback for button/label text
4. CSS selectors - Last resort

### Wait Strategies

```typescript
// Wait for network to be idle
await page.waitForLoadState("networkidle", { timeout: 10_000 });

// Wait for specific element
await expect(element).toBeVisible({ timeout: 5000 });

// Wait for navigation
await page.waitForURL((url) => url.includes("/dashboard"));
```

### Handling Optional Elements

Many tests check for element visibility with `.catch(() => false)` to gracefully
handle optional UI elements:

```typescript
const isVisible = await element.isVisible().catch(() => false);
if (isVisible) {
  // Element exists - test it
}
```

This approach allows tests to pass even if certain UI components are optional.

### Test Data

Use `TEST_FIXTURES` from `fixtures/test-data.ts` for consistent test data across
all tests. This ensures:

- Consistent credentials
- Predictable test data
- Easy maintenance of fixtures
- Reusable mock responses

## Debugging

### Run Single Test

```bash
npx playwright test auth.spec.ts
```

### Run Specific Test

```bash
npx playwright test -g "Login flow"
```

### Debug Mode

```bash
npx playwright test --debug
```

### View Report

```bash
npx playwright show-report
```

### Verbose Output

```bash
npx playwright test --reporter=list
```

## Common Issues

### Authentication State Not Persisting

- Ensure browser context storage is properly saved
- Check token storage in localStorage/sessionStorage
- Verify session cookie domain settings

### API Calls Failing

- Verify mock-server is running on port 3010
- Check Go backend is running on ports 18080-18081
- Review API mock interceptors in `fixtures/api-mock.ts`

### Tests Timing Out

- Increase timeout in specific tests: `{ timeout: 60_000 }`
- Check that web servers are properly started
- Verify network connectivity

### Selector Issues

- Use Playwright inspector: `npx playwright test --debug`
- Check browser dev tools for correct selectors
- Update test IDs if UI structure changes

## Contributing

When adding new tests:

1. Use existing helpers from `fixtures/auth.ts`
2. Use test data from `fixtures/test-data.ts`
3. Mock APIs using `fixtures/api-mock.ts`
4. Follow selector priority order
5. Add clear test descriptions
6. Include comments for complex logic
7. Test happy path and error cases
8. Handle optional UI elements gracefully

## References

- [Playwright Documentation](https://playwright.dev)
- [Best Practices](https://playwright.dev/docs/best-practices)
- [Selectors Guide](https://playwright.dev/docs/selectors)
- [Debugging Tests](https://playwright.dev/docs/debug)
