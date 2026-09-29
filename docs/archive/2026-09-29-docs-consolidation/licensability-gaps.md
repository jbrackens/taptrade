# Licensability gaps — what the PAM branch built that `main` still lacks

**Verified 2026-09-06 against `main` @ `3e331818`.** This is a live document about the *current*
system, not an archive. It exists because the `pam/p0-modernization` branch — 345 commits of
back-office licensability work — was never merged and has now been retired to the tag
`archive/pam-p0-modernization-2026-07-06`. Deleting the branch without this register would have lost
the findings.

**How to use it.** Nothing here should be cherry-picked. The branch was written on the pre-rebrand
tree with pre-points units and colliding migration numbers (see
`docs/archive/2026-07-pam-modernization/README.md`). Read the reference implementation at the tag,
then build fresh against current `main`.

**Scope caveat, stated honestly.** The audit that produced this table covered the P0/P1 tier and the
P10 residuals. The GAP-40…GAP-105 tier — including the dual-approval segregation-of-duties split
(migrations 060/061), the least-privilege Market-Operations role, and roughly a dozen operator
screens — was **not** assessed before the audit run was cut short. Those items are listed in
`docs/archive/2026-07-pam-modernization/PROGRESS_LEDGER.md` under FINAL TERMINATION and still need a
pass against `main`.

---

## Confirmed gaps

| # | Capability | Why it matters | Status on `main` (verified) | PAM reference | Approach |
|---|---|---|---|---|---|
| 1 | **Enforced staff MFA** — DB-backed TOTP enrol/activate/disable, required at login for `role=admin`, single-use codes, secrets encrypted at rest, admin OAuth sign-in denied | A back office with a cosmetic 2FA switch is a standard diligence and audit finding, independent of the points-only policy | **Absent.** `services/auth` contains no TOTP/MFA code at all. `internal/http/handlers.go:40` holds `twoFactorEnabled map[string]bool` — an **in-memory** map (lost on restart), flipped by `POST /api/v1/auth/2fa/toggle` at `:835`, and **never consulted during login**. Admin login falls back to `admin_users` at `:932` with no second factor | commits `6914421c`, `268157b8`; follow-ons `789e26b6` (single-use), `9a4284ad` (AES-256-GCM at rest), `5c4c105c` (reset), `70663a00` (office reset control) | Re-implement fresh. `mfa.go` / `totp.go` are self-contained over an `auth_mfa` table; the auth service layout is unchanged, but `handlers.go` has ~260 commits of drift. Needs an office enrolment screen — main has none |
| 2 | **KYC store fails closed outside dev** | Today a database hiccup silently downgrades identity checks to an auto-approving mock, in production, with only a `slog.Warn` | **Absent.** `gateway/internal/http/handlers.go:511` falls back to `compliance.NewMockKYCService()` when the Postgres KYC store fails to initialise, and `:526` does the same when no DB is wired — in **every** environment. `compliance/fail_closed.go` defines `FailClosedKYCService` but **nothing calls it** | commit `5adf223c` (`KYCFallbackForEnv`), extended by `618b39fa`, `04086b92` | Re-implement fresh — ~40 lines across three files that exist on main at the same paths. Not a gate while KYC is off, but it becomes critical the day `KYC_REQUIRED_FOR_TRADING` is enabled |
| 3 | **KYC review workflow** — document file storage, pending-review list, back-office review screen, player KYC tab | The decision endpoint exists but has no operator surface; review is a curl-level operation today | **Partial.** Present: `POST /api/v1/admin/kyc/decision` (`kyc_admin_handlers.go:45`, `compliance:write`, audited). Absent: file bytes (`kyc_documents` stores metadata only), no pending-review route, no office KYC page or profile tab | `f6501f0a`, `b95fe9a0`, `ad6e84c4`, `e958d172` | Backend half ports cleanly; the office half must be rebuilt on the current office design |
| 4 | **Maker-checker on manual balance adjustments** | Staff can move player balances single-handed; four-eyes is a standard control | **Partial.** Settlement four-eyes is **present and predates the fork** (`prediction/settlement.go:234`, `:388`) — the PAM design note's premise was already stale. Absent: adjustments. `admin_handlers.go:180` executes wallet credit/debit immediately under `finances:write` with only an audit row | `5cbecd9a`, `f73d3036`, `54a0fad4` (migration 060: `finances:approve` + Finance-Approver role) | Re-implement fresh; note the migration renumbering |
| 5 | **Market-integrity surveillance** — wash/self-trade, spoofing and collusion detectors feeding alerts and cases | Market-manipulation monitoring is expected of anything calling itself an exchange, points or not | **Absent** | PAM P1-4 | Re-implement fresh; scope to what a points market actually needs |
| 6 | **Duplicate-account / fraud detection** — email-normalisation collision detection (plus-addressing, Gmail dot and googlemail aliases) | Multi-accounting is the main abuse vector for a faucet-funded points economy | **Partial** | PAM P1-5 | Re-implement fresh |
| 7 | **RG session limits that actually enforce** | A limits route that reports success while enforcing nothing is precisely what a licensing review flags | **Partial** — see `designs/gap-11-session-limit.md` | PAM GAP-11 | Re-implement fresh |
| 8 | **Environment-name allowlist on protected-core gates** | An `ENVIRONMENT` value of `prod`, `preprod`, or a typo silently disables the responsible-gaming gate and other protected-core checks | **Partial** — the fix is small (allowlist the recognised names and refuse unknown ones) | `designs/gap-69-protected-core-env-checks.md` | Re-implement fresh — cheapest item here |

## Deliberately not gaps (do not re-litigate)

- **Settlement four-eyes** — already on `main`, predates the fork (see #4).
- **Fiat PSP / withdrawals / AWA auto-approval / custody** — obsolete under the points-only launch.
  The abandonment record is `docs/archive/cashier/README.md`.
- **Bonus-turnover compliance load** — under points-only, bonus Points convert to tradeable Points
  with no withdrawable value, so the "free money" compliance concern evaporates.
- **Multi-tenancy (`p2-1-design.md`)** — substantively a restatement of ADR-0005.

## Open residuals from the rejected 2026-07 redesign

Small, verified, unrelated to licensability — listed here so they are not lost with that branch either:

- `FeaturedCarousel.tsx:39,117` auto-advances every 7s with no visible stop control (pauses on
  hover/focus and respects reduced-motion, so WCAG 2.2.2 is arguable, not clean).
- `MarketFeed.tsx:361` still renders population-claim sentiment strings ("*{{percentage}}% say Yes*",
  `en/prediction.json:98–102`) on `/series` and `/category`. `MarketCard` was reworded to price
  framing; `MarketFeed` was missed.
- `app/layout.tsx:19` meta description still reads "the moments Filipinos are watching".
- `packages/app/package.json` still ships `jsonwebtoken` and `yup` with zero imports.
