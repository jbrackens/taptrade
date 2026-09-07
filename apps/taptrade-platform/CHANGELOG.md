# Tap Trade Changelog

## [Unreleased] - 2026-05-23

### Compliance, payments, liquidity, and notifications build-out

Closes the gap between "the trading engine works" and "the platform can run a real closed beta." Everything below is verified end-to-end against the live stack.

### Added

- **Identity verification (KYC) that survives restarts.** Verification status and documents now persist in PostgreSQL instead of an in-memory map. Submissions queue for back-office review (a compliance operator approves/rejects via a new admin action); an automated vendor (Sumsub/Onfido/Persona) drops in by configuration. Until a vendor is configured the flow fails safe — it never auto-approves.
- **Crypto (USDC) deposit rail.** New `/api/v1/payments/crypto/config` and `/api/v1/payments/crypto/deposit-address` endpoints behind a clean on-chain adapter. It fails closed (no fake addresses) until you supply an RPC endpoint, the asset contract, and a deposit-address source.
- **Resolution notifications.** When a market settles or voids, the gateway now sends an out-of-band notification (email when SMTP is configured; recorded to the structured log otherwise) alongside the existing real-time WebSocket push.
- **Dynamic order-book liquidity.** The synthetic market maker is enabled on the demo with risk caps (per-market depth + a per-side position cap), so every open market keeps a live two-sided book instead of a static seeded one.
- **Prediction end-to-end tests.** A new Playwright suite (`frontend/e2e/prediction/`) covers login, market data, order fill, portfolio accounting, the full KYC lifecycle, admin authorization, and the crypto rail's fail-closed contract. 10/10 green against the live stack.

### Changed

- Responsible-gambling limits are now served by the PostgreSQL-backed service (the in-memory mock is only a no-database fallback for tests). It gained a per-user atomic bet-limit gate so concurrent orders cannot collectively slip past a period limit.
- The demo deployment turns the market maker on and documents off-by-default activation knobs for the crypto rail, KYC vendor, SMTP, and jurisdiction gate in `docker-compose.demo.yml`.

### Fixed

- Backoffice dashboard tables now stay inside the responsive shell after the Tailwind migration, and player market cards tolerate all supported gathered-image fields with a safe fallback for missing or broken thumbnails.
- The market maker no longer floods the logs with a warning for every market on every tick when it holds no position there (a missing position is the normal cold-market case, not an error).

### For contributors

- Removed ~47 stale root-level planning/primer/audit documents; the audit findings live in code, not in those files.
- New gateway packages: `internal/notify` (notification channel), plus `compliance/kyc_postgres.go` + `compliance/idv.go` (DB-backed KYC + verification-provider seam) and `payments/crypto_rail.go` (on-chain rail seam). The compliance and crypto tables self-create on startup via `CREATE TABLE IF NOT EXISTS`, so no migration is required.

---

## [2.0.0] - 2026-04-16

### Prediction-Market Fork

Taya NA Predict forked from Taya NA Sportsbook and replaced the sportsbook domain with prediction-market contracts.

### Changed

- Player app now centers on `/predict`, `/market/[ticker]`, `/portfolio`, and category discovery.
- Domain language changed from fixtures/selections/bets to categories/events/markets/orders/positions.
- Prices are cents from 0 to 100; YES price maps to implied probability.
- Gateway exposes prediction, order, portfolio, settlement, wallet, loyalty, leaderboard, and auth-proxy routes.
- Docker Compose uses prediction-specific local ports: PostgreSQL `5434`, Redis `6380`, gateway `18080`, auth `18081`.
- Demo player login remains `demo@taptrade.local` / `demo123`.

### Migration Notes

- Do not edit shipped migration `014_prediction_schema.sql` in place. Add new goose migrations for schema changes.
- Do not introduce new sportsbook naming in prediction code. Avoid `fixtures`, `selections`, `betslip`, `sport_key`, and `punter_bets`.
- Use `@taptrade-ui/api-client` prediction exports for new client code.
- Use `npm run dev -- -p 3010` for the player-only development loop.

### Known Gaps

- Historical chart time-range controls are disabled until backend price history is connected.
- Some archived sportsbook documentation remains under legacy/reference directories for git-blame context.

---

# Archived Sportsbook-Era Release Changelog

## [1.2.0] - 2026-04-16

### UAT Defect Resolution (34 defects fixed)

Comprehensive UAT uncovered 36 defects; 34 confirmed and fixed in this release. Full report: `UAT-REPORT-2026-04-15.md`.

### Critical Fixes
- **Odds Display Restored** — Fixed `selectionOdds` field name mismatch in BetConstruct market mapping; all match pages and event cards now show real decimal odds
- **SSR Crash Fix** — Guarded `window.location.origin` access in `apiClient.get()` during server-side rendering; /leaderboards, /responsible-gaming, /rewards, /promotions no longer crash the server
- **i18n Namespace** — Added `rewards` to `INIT_NAMESPACES` to prevent hydration mismatch on rewards page

### Search & Navigation
- Search now matches sport display names (searching "Football" finds soccer events)
- Search results show human-readable sport names instead of raw keys
- Internal competition IDs removed from search result labels
- Duplicate React key for rugby sports fixed in Quick Browse chips
- Notification bell linked to /account/notifications

### Data Quality
- Leaderboard metrics humanized (net_profit_cents → "Net Profit")
- Raw player IDs replaced with "Player N" in standings
- Reward activity labels humanized (first_qualified_referral → "First Qualified Referral")
- Cashier balance fallback changed from "—" to "$0.00"
- Non-league entries (Outright, Transfer Specials) filtered from league tabs
- TBD season template entries filtered from Starting Soon page

### Match Page
- Live score display added between team names for in-progress matches
- Duplicate market groups deduplicated
- Popular tab now prioritizes moneyline markets over niche Asian handicaps
- Internal event IDs removed from homepage featured cards

## [1.1.0] - 2026-04-14

### TAYA NA! Design System & Feature Release

Complete rebrand to TAYA NA! identity with unified design system, new player features, and production stabilization across 16 commits.

### New Features

- **Unified Design System** — Dark navy (`#0b0e1c`) surfaces with neon green (`#39ff14`) brand energy, IBM Plex Sans typography, consistent spacing tokens across both player app and admin backoffice
- **Leaderboards in Navigation** — Competition leaderboards (Weekly Profit Race, Weekly Stake Ladder, Qualified Referral Race) now discoverable from the top nav bar
- **Match Detail Page** — Rewired from BetConstruct Swarm to Go gateway; displays real markets with Popular, Game Lines, Player Props, and All tabs
- **User Menu with Logout** — Avatar dropdown with account links, settings, and a visible logout button
- **Session Management API** — `GET /api/v1/auth/sessions` and `DELETE /api/v1/auth/sessions/{id}` for viewing and revoking active sessions
- **SVG Sport Icons** — Replaced all emoji icons with proper SVG icons across 10 sports
- **Real Logo** — TN logo replaces CSS-constructed placeholder throughout

### Production Stabilization

- **Structured Logging** — `log/slog` JSON output in production across all Go services
- **OpenTelemetry Tracing** — Request-scoped spans for wallet, settlement, and compliance flows
- **Dead Letter Queue** — Failed settlements retry with exponential backoff, DLQ after 3 attempts
- **Race Condition Fixes** — Concurrent bet placement and settlement serialized correctly
- **26 Production Blockers Resolved** — Auth middleware, CSRF protection, atomic settlement, health checks, graceful shutdown

### Seed Data

- **26 fixtures across 10 sports** — Baseball, Basketball, Football, Tennis, MMA, Boxing, Cricket, Ice Hockey, Esports (CS2, Dota 2), with realistic teams, leagues, and market odds

### Design Polish

- Sidebar logo enlarged to 48px with correct aspect ratio
- Topbar button touch targets increased to 44px minimum
- Sidebar navigation icons normalized to 18px
- 85 lines of dead CSS-constructed logo code removed
- Static asset auth redirect fixed

### Bug Fixes

- Fixed 502 error on match detail page (BetConstruct `Number()` coercion of string fixture IDs)
- Fixed i18n hydration mismatch and key flash on page reload
- Eliminated 127 `any` types in legacy components
- Resolved IDOR vulnerability and null safety crash
- Fixed 14 code quality issues (stale closures, timer types, catch block typing)

### Technology Stack (Updated)

- **Player App** — Next.js 16, React 19, Tailwind CSS, lucide-react
- **Admin Backoffice** — Next.js 16, React 19, Ant Design
- **Backend** — Go 1.24, PostgreSQL 16, Redis 7

---

## [1.0.0] - 2026-04-02

### Initial Production Release

The sportsbook-era platform reaching production-ready status. Complete sportsbook solution with real-time betting, market management, and comprehensive compliance framework.

### Major Features

#### Multi-Sport Support
- Football (including NFL, Premier League, La Liga, Serie A, Bundesliga)
- Basketball (NBA, EuroLeague)
- Tennis (Grand Slams, ATP, WTA)
- Cricket (Test, ODI, T20)
- American Football (NFL, College Football)
- Ice Hockey (NHL)
- Baseball (MLB)
- Extensible architecture for adding new sports

#### Market Types & Betting Options
- **Moneyline** — Simple win/loss/draw betting
- **Spread Betting** — Points/goals spread with -1.5/+1.5 style pricing
- **Totals** — Over/under betting on combined points
- **Props** — Player and game-specific prop bets
- **Player Props** — Individual player performance bets
- **Parlays** — Multi-leg accumulators with automatic odds calculation

#### Real-Time Betting Engine
- **WebSocket Architecture** — Instant odds and bet confirmations
- **Live Odds Updates** — Sub-100ms broadcast of odds changes to all connected clients
- **Concurrent User Support** — Designed for 10,000+ simultaneous WebSocket connections
- **Automatic Failover** — Graceful handling of connection drops with auto-reconnect
- **Multi-Market Streaming** — Subscribe to specific markets or all markets

#### Player Features
- **Dark Theme Interface** — Modern, eye-friendly design
- **Bet Slip Management** — Add/remove selections with live odds recalculation
- **Accumulator Builder** — Easy multi-leg bet construction
- **Live Betting** — Place bets during matches with in-play odds
- **Quick Bet** — One-click bet placement with customizable stake
- **Bet History** — View all past bets with detailed settlement information
- **Cash Out** — Early settlement of bets at current market prices
- **Responsible Gaming** — Session limits, deposit limits, self-exclusion options

#### Backoffice Administration
- **Real-Time Exposure Tracking** — Live P&L for each market
- **Market Control** — Manual suspend/resume of markets
- **Odds Management** — View and adjust odds across all markets
- **Settlement Tools** — Manual market settlement with result confirmation
- **User Management** — Account suspension, KYC verification, balance adjustment
- **Trading View** — Advanced trading interface for professional traders
- **Risk Monitoring** — Automatic alerts for exposure threshold breaches
- **Audit Logs** — Complete action trail for compliance

#### Financial Management
- **Wallet System** — User account balance and transaction tracking
- **Deposit Processing** — Credit card and bank transfer integration (stub implementation)
- **Withdrawal Management** — Approval workflow and fund transfer
- **Ledger** — Complete transaction history with detailed categorization
- **Free Bets** — Promotional freebet allocation and usage tracking
- **Odds Boosts** — Enhanced odds for selected markets
- **Settlement** — Automatic payout calculation and wallet credit

#### Compliance & Audit
- **KYC/AML Framework** — User identity verification hooks
- **Audit Logging** — All user actions logged with timestamp and IP
- **Data Retention Policies** — Configurable retention for different data types
- **Regulatory Reporting** — Export capabilities for regulatory submission
- **User Suspension** — Account restrictions and banning capability
- **Transaction Monitoring** — Suspicious pattern detection framework

#### Trading Features (Backoffice)
- **Live Market View** — Real-time odds and bet flow visualization
- **Odds Trading** — Move odds up/down to manage exposure
- **Market Suspension** — Instant market closure with queue management
- **Bet Acceptance/Rejection** — Manual control over bet placement
- **Risk Limit Configuration** — Set exposure limits per market, fixture, and user
- **Player Exposure** — View individual user's potential payout

### Technology Stack

#### Backend Services
- **Gateway Service** — Go 1.24, handles all API requests and WebSocket connections
- **Auth Service** — Go 1.24, dedicated authentication and token management
- **Database** — PostgreSQL 16 with comprehensive schema design
- **Cache** — Redis 7 for sessions, market data, and pub/sub
- **Container Runtime** — Docker with multi-stage builds
- **Orchestration** — Kubernetes 1.28+ for production deployment

#### Frontend Applications
- **Player App** — Next.js 16, React 19, TypeScript, Tailwind CSS
- **Backoffice** — Next.js 16, React 19, TypeScript, Ant Design
- **API Client** — TypeScript client with OpenAPI integration

#### DevOps & Infrastructure
- **CI/CD** — GitHub Actions for automated testing and deployment
- **Version Control** — Git with conventional commits
- **Container Registry** — Docker Hub, Google Artifact Registry, or equivalent
- **Infrastructure as Code** — Kubernetes manifests, Docker Compose for dev
- **Monitoring** — Prometheus for metrics, Grafana for dashboards
- **Logging** — Structured logging with ELK Stack support

### Performance Characteristics

- **Bet Placement Latency** — < 100ms (P95)
- **WebSocket Broadcast** — < 100ms for odds update to all subscribers
- **Database Query Time** — < 50ms (P95) for typical queries
- **Page Load Time** — < 2s (First Contentful Paint)
- **Concurrent WebSocket Connections** — 10,000+ per Gateway instance
- **Throughput** — 1,000+ API requests per second per Gateway instance

### Database Schema

Complete schema with 12 tables:
- `punters` — User accounts
- `sports` — Sport types
- `tournaments` — Leagues and tournaments
- `fixtures` — Individual matches/games
- `markets` — Betting markets
- `selections` — Market outcomes
- `bets` — User bets
- `wallets` — User account balances
- `ledger_entries` — Financial transactions
- `freebets` — Promotional free bets
- `audit_logs` — Action audit trail
- `match_timelines` — Live match events

See migrations in `go-platform/services/gateway/migrations/` for full schema details.

### Security Features

- **TLS 1.3** — All external communication encrypted
- **JWT Tokens** — Stateless authentication with configurable TTL
- **Password Security** — Bcrypt hashing with salt
- **Rate Limiting** — Per-IP request throttling
- **Input Validation** — All user inputs validated
- **SQL Injection Prevention** — Parameterized queries throughout
- **CORS Configuration** — Configurable allowed origins
- **Secrets Management** — Environment variables for sensitive data

### High Availability

- **Stateless Services** — Gateway and Auth can scale horizontally
- **Database Replication** — PostgreSQL streaming replication for failover
- **Connection Pooling** — PgBouncer or application-level pooling
- **Cache Redundancy** — Redis cluster with automatic failover
- **Load Balancing** — Session-aware load balancing for WebSocket
- **Graceful Shutdown** — 30-second drain period before termination

### Scalability

- **Horizontal Scaling** — Add more Kubernetes pods for Gateway/Auth
- **Vertical Scaling** — Increase instance resources as needed
- **Database Scaling** — Read replicas for reporting, sharding for large deployments
- **CDN Integration** — Static assets cached at edge
- **Caching Strategy** — Multi-layer caching (browser, CDN, application, database)

### Testing & Quality Assurance

- **Unit Tests** — Go tests for all business logic
- **Integration Tests** — Database and API integration testing
- **E2E Tests** — Playwright tests for critical user paths
- **Load Testing** — Apache JMeter/k6 baseline established
- **Security Testing** — Dependency scanning, secrets detection
- **Performance Testing** — Response time and throughput benchmarks

### Documentation

- **ARCHITECTURE.md** — System design and data flow
- **DEVELOPMENT.md** — Local development setup guide
- **DEPLOYMENT.md** — Production deployment procedures
- **RUNBOOKS.md** — Operational procedures and incident response
- **README.md** — Project overview and quick start

### Known Limitations

- **Payment Processing** — Stub implementation only, requires payment provider integration
- **Provider Integration** — Example provider integration, requires actual feed connection
- **Single Region** — Deployed in single cloud region, multi-region requires additional setup
- **Data Retention** — Default 90-day retention, configurable as needed
- **Support Hours** — Support during business hours (configurable)

### Bug Fixes & Improvements

- [CORE-001] Fixed WebSocket connection leak on client disconnect
- [CORE-002] Improved database query performance with additional indexes
- [CORE-003] Enhanced error handling for network timeouts
- [CORE-004] Fixed race condition in wallet debit/credit operations
- [CORE-005] Improved logging for debugging production issues
- [CORE-006] Fixed CORS configuration for cross-origin requests
- [CORE-007] Enhanced form validation in Player App
- [CORE-008] Fixed ledger decimal precision issues

### Migration Guide

**For users upgrading from beta:**
1. No breaking changes — all APIs are backward compatible
2. Database schema is stable — no migrations required from beta
3. Recommended: Update to latest client version for bug fixes

**For new installations:**
1. Follow [DEPLOYMENT.md](./DEPLOYMENT.md) for infrastructure setup
2. See [DEVELOPMENT.md](./DEVELOPMENT.md) for local development
3. Review [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md) before going live

### Breaking Changes

None. Full backward compatibility with beta releases.

### Deprecations

None at this time.

### Future Roadmap

#### v1.1.0 (Q2 2026)
- Live streaming integration
- Voice betting capability
- Enhanced analytics dashboard
- Mobile native apps

#### v1.2.0 (Q3 2026)
- Multi-currency support
- API webhooks for third-party integration
- Advanced trading algorithms
- Tier-based user rewards program

#### v2.0.0 (Q4 2026)
- Blockchain settlement (if regulatory approval obtained)
- Peer-to-peer betting
- Custom market creation by users
- Advanced visualization tools

### Contributors & Acknowledgments

The sportsbook-era platform was developed by the core team. Special thanks to all testers and early users who provided feedback.

### License

All rights reserved. DORA Research, Inc.

### Support

For issues or questions:
- **Technical Support** — support@taptrade-sportsbook.com
- **Bug Reports** — bugs@taptrade-sportsbook.com
- **Feature Requests** — features@taptrade-sportsbook.com

---

## Older Releases

### [0.9.0] - Beta Release

Initial beta release with core functionality for testing.

### [0.5.0] - Alpha Release

Early alpha with basic betting functionality.
