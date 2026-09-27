package discover

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"time"

	"taptrade/gateway/internal/prediction"
)

// Settlement defaults applied to every promoted market.
const (
	defaultAMMLiquidityParam = 100.0
	defaultAMMSubsidyPoints  = 10000 // $100/market
	defaultSettlementRule    = "manual_attestation"
	defaultSettlementSource  = "manual"
	farFutureCloseAt         = "2099-12-31T23:59:59Z"
	// settlementCutoffPad is added to a market's close_at to set its
	// settlement_cutoff_at. The AutoSettler worker picks up rows where
	// status='closed' AND settlement_cutoff_at <= NOW(), so this gives the
	// upstream a 1-hour grace window between close and the worker firing.
	settlementCutoffPad = 1 * time.Hour
)

// PromoteResult is the per-run summary for the promotion step.
type PromoteResult struct {
	Created          int            // newly inserted, status=open
	Resolved         int            // newly inserted, status=settled with payouts
	ResolvedExisting int            // existing-ticker rows we transitioned and settled
	Closed           int            // newly inserted, status=closed (ambiguous, awaiting manual)
	Removed          int            // existing imported rows voided because upstream is inactive/expired
	Skipped          int            // already exists, no new resolution to apply
	Unsuitable       int            // rejected by the curation guard (ad-spam titles)
	Failed           int            // logged via slog.Warn, sync continues
	ByCategory       map[string]int // category -> count of created+resolved
}

// PredictionRepo is the subset of prediction.Repository we read from. We
// use the Service for any write that needs FSM enforcement, lifecycle audit,
// or the settlement engine.
type PredictionRepo interface {
	GetMarketByTicker(ctx context.Context, ticker string) (*prediction.Market, error)
}

// Service is the subset of prediction.Service we call for writes. Defined
// locally so the package stays decoupled from the full interface.
type Service interface {
	CreateMarket(ctx context.Context, req prediction.CreateMarketRequest) (*prediction.Market, error)
	TransitionMarketStatus(ctx context.Context, marketID string, to prediction.MarketStatus, reason string, actorID *string) error
	ResolveMarket(ctx context.Context, marketID string, req prediction.ResolveMarketRequest, settledBy *string) (*prediction.Settlement, []prediction.Payout, error)
}

// Promote turns a list of fetched-and-deduped markets into first-class AMM
// rows in `prediction_markets`. Idempotent on re-run.
//
// Per-market flow:
//
//	mentionsUpstream(title|desc)? → skip
//	classify → category
//	resolveCategoryID + ensureSyntheticEvent → eventID
//	stable ticker
//	row already exists?
//	  yes + Resolution + still open locally → transition closed → ResolveMarket
//	  yes + no Resolution                   → skip (idempotent)
//	  yes + Resolution + already settled    → skip (idempotent)
//	  no                                    → insert based on Resolution:
//	    open upstream:    Service.CreateMarket → TransitionMarketStatus(open)
//	    resolved YES/NO:  Service.CreateMarket → Transition(open) → Transition(closed) → ResolveMarket
//	    ambiguous:        Service.CreateMarket → Transition(open) → Transition(closed)
//	                      (manual adapter settles via /api/v1/admin/settlements)
//
// Service.CreateMarket creates rows at status='unopened' with default 50/50
// prices. We follow up by writing the AMM share state directly so the LMSR
// price matches the displayed price (P0-2 fix), and by transitioning into
// the correct lifecycle state (P0-3 fix).
func Promote(
	ctx context.Context,
	db *sql.DB,
	repo PredictionRepo,
	svc Service,
	markets []Market,
) (PromoteResult, error) {
	res := PromoteResult{ByCategory: map[string]int{}}

	catIDs, err := resolveCategoryIDs(ctx, db)
	if err != nil {
		return res, fmt.Errorf("resolve categories: %w", err)
	}
	eventIDs, err := ensureSyntheticEvents(ctx, db, catIDs)
	if err != nil {
		return res, fmt.Errorf("ensure synthetic events: %w", err)
	}

	for _, m := range markets {
		if mentionsUpstream(m.Title) || mentionsUpstream(m.Description) {
			res.Skipped++
			continue
		}
		if IsLaunchProhibitedMarket(m) {
			res.Skipped++
			continue
		}
		// Curation guard: advertisements never enter the catalog. Existing
		// rows are handled below (and by CurateImportedCatalog each cycle),
		// so a signature added later still cleans up history.
		if IsUnsuitableImport(m.Title) || IsUnsuitableImport(m.Description) {
			res.Unsuitable++
			slog.Info("promote: rejected unsuitable import", "title", m.Title)
			continue
		}

		category := Classify(m)
		catchAllID, ok := eventIDs[category]
		if !ok {
			slog.Warn("promote: unknown category, skipping", "category", category)
			res.Failed++
			continue
		}
		// An import that belongs to an upstream event (a game, an election
		// with several candidates) gets that event as its parent, so the
		// board can show one card per event; the per-category catch-all is
		// only for imports with no event of their own.
		imagePath := imagePathFor(ctx, db, m)
		eventID := catchAllID
		if m.EventGroup != "" {
			if id, err := ensureUpstreamEvent(ctx, db, m, catIDs[category], imagePath); err != nil {
				slog.Warn("promote: upstream event failed; using catch-all", "event_group", m.EventGroup, "err", err)
			} else {
				eventID = id
			}
		}

		ticker := generateTicker(m)
		existing, _ := repo.GetMarketByTicker(ctx, ticker)
		if existing != nil {
			// Rows promoted before upstream events existed sit in the
			// catch-all; move them under their event once it is known.
			if eventID != catchAllID && existing.EventID == catchAllID {
				if _, err := db.ExecContext(ctx,
					`UPDATE prediction_markets SET event_id = $1 WHERE id = $2 AND event_id = $3`,
					eventID, existing.ID, catchAllID); err != nil {
					slog.Warn("promote: relink to upstream event failed", "ticker", ticker, "err", err)
				}
			}
			// A previously-promoted row that now fails the guard (either
			// side of the sync) is retired, not resynced.
			if IsUnsuitableImport(existing.Title) {
				if voidExistingImported(ctx, svc, existing, "curation: unsuitable imported title") == "removed" {
					res.Unsuitable++
				}
				continue
			}
			outcome := applyUpstreamStateToExisting(ctx, svc, existing, m)
			switch outcome {
			case "resolved":
				res.ResolvedExisting++
				res.ByCategory[category]++
			case "removed":
				res.Removed++
			case "skip":
				res.Skipped++
			case "fail":
				res.Failed++
			}
			continue
		}

		if shouldRemoveFromPlayer(m) {
			res.Skipped++
			continue
		}

		// New market: create at unopened, then walk the FSM into the right state.
		yesC, noC := clampPrices(m.Prices)
		closeAt := pickCloseAt(m.EndTime)
		cutoff := closeAt.Add(settlementCutoffPad)

		req := prediction.CreateMarketRequest{
			EventID:             eventID,
			Ticker:              ticker,
			Title:               m.Title,
			Description:         m.Description,
			SettlementSourceKey: defaultSettlementSource,
			SettlementRule:      defaultSettlementRule,
			SettlementParams:    json.RawMessage("{}"),
			CloseAt:             closeAt,
			SettlementCutoffAt:  &cutoff,
			AMMLiquidityParam:   defaultAMMLiquidityParam,
			AMMSubsidyPoints:    defaultAMMSubsidyPoints,
		}
		mkt, err := svc.CreateMarket(ctx, req)
		if err != nil {
			slog.Warn("promote: create failed", "ticker", ticker, "err", err)
			res.Failed++
			continue
		}

		// Write AMM share state and image_path directly so the LMSR price
		// matches the displayed price. CreateMarket leaves shares at zero
		// (which prices the market at 50/50) and doesn't accept image_path.
		yesShares, noShares := initAMMShares(float64(yesC)/100.0, defaultAMMLiquidityParam)
		if err := writeInitialState(ctx, db, mkt.ID, yesC, noC, yesShares, noShares, imagePath); err != nil {
			slog.Warn("promote: write initial state failed", "ticker", ticker, "err", err)
			res.Failed++
			continue
		}

		// Walk the FSM. CreateMarket leaves the row at status=unopened.
		actor := "promote"
		if err := svc.TransitionMarketStatus(ctx, mkt.ID, prediction.MarketStatusOpen, "promote: opened from upstream", &actor); err != nil {
			slog.Warn("promote: transition open failed", "ticker", ticker, "err", err)
			res.Failed++
			continue
		}

		// Branch on resolution.
		if m.Resolution == nil {
			res.Created++
			res.ByCategory[category]++
			continue
		}

		switch m.Resolution.Outcome {
		case "yes", "no":
			if err := svc.TransitionMarketStatus(ctx, mkt.ID, prediction.MarketStatusClosed, "promote: closed for upstream resolution", &actor); err != nil {
				slog.Warn("promote: transition closed failed", "ticker", ticker, "err", err)
				res.Failed++
				continue
			}
			result := prediction.MarketResultYes
			if m.Resolution.Outcome == "no" {
				result = prediction.MarketResultNo
			}
			if _, _, err := svc.ResolveMarket(ctx, mkt.ID, prediction.ResolveMarketRequest{
				Result:            result,
				AttestationSource: "upstream",
				AttestationData:   buildAttestation(m),
			}, &actor); err != nil {
				slog.Warn("promote: resolve failed", "ticker", ticker, "err", err)
				res.Failed++
				continue
			}
			res.Resolved++
			res.ByCategory[category]++

		case "ambiguous":
			// Manifold MKT or CANCEL: don't auto-resolve. Park as closed so
			// the ops queue picks it up via /api/v1/admin/settlements.
			if err := svc.TransitionMarketStatus(ctx, mkt.ID, prediction.MarketStatusClosed, "promote: closed pending manual review", &actor); err != nil {
				slog.Warn("promote: transition closed failed", "ticker", ticker, "err", err)
				res.Failed++
				continue
			}
			res.Closed++
			res.ByCategory[category]++
		}
	}

	return res, nil
}

// applyUpstreamStateToExisting handles the "ticker already exists" branch.
// Returns "resolved" if we transitioned + resolved a previously-open market,
// "removed" if we voided an imported market that is no longer active upstream,
// "skip" if there's nothing to do (already terminal, or no new upstream signal),
// "fail" if a transition or resolve errored.
func applyUpstreamStateToExisting(ctx context.Context, svc Service, existing *prediction.Market, m Market) string {
	if m.Resolution == nil {
		if shouldRemoveFromPlayer(m) {
			return voidExistingImported(ctx, svc, existing, "re-sync: upstream market inactive or expired")
		}
		return "skip"
	}
	// Only act on markets that are still in the open lifecycle. Settled,
	// voided, or already closed manually are out of scope here.
	if existing.Status != prediction.MarketStatusOpen {
		return "skip"
	}
	if m.Resolution.Outcome == "ambiguous" {
		return voidExistingImported(ctx, svc, existing, "re-sync: upstream market closed without a binary result")
	}
	actor := "promote-resync"
	if err := svc.TransitionMarketStatus(ctx, existing.ID, prediction.MarketStatusClosed, "re-sync: upstream resolved", &actor); err != nil {
		slog.Warn("applyResolution: transition closed failed", "ticker", existing.Ticker, "err", err)
		return "fail"
	}
	result := prediction.MarketResultYes
	if m.Resolution.Outcome == "no" {
		result = prediction.MarketResultNo
	}
	if _, _, err := svc.ResolveMarket(ctx, existing.ID, prediction.ResolveMarketRequest{
		Result:            result,
		AttestationSource: "upstream",
		AttestationData:   buildAttestation(m),
	}, &actor); err != nil {
		slog.Warn("applyResolution: resolve failed", "ticker", existing.Ticker, "err", err)
		return "fail"
	}
	return "resolved"
}

func shouldRemoveFromPlayer(m Market) bool {
	if m.Resolution != nil {
		return m.Resolution.Outcome == "ambiguous"
	}
	status := strings.ToLower(strings.TrimSpace(m.Status))
	if status == "closed" || status == "inactive" || status == "expired" || status == "settled" || status == "finalized" {
		return true
	}
	now := timeNowUTC()
	return marketExpired(m.EndTime) || marketEventDatePassed(m, now) || marketImpossibleOutcomePassed(m, now)
}

func voidExistingImported(ctx context.Context, svc Service, existing *prediction.Market, reason string) string {
	if prediction.IsTerminal(existing.Status) {
		return "skip"
	}
	actor := "market-sync"
	if err := svc.TransitionMarketStatus(ctx, existing.ID, prediction.MarketStatusVoided, reason, &actor); err != nil {
		slog.Warn("promote: void stale imported market failed", "ticker", existing.Ticker, "err", err)
		return "fail"
	}
	return "removed"
}

// initAMMShares returns the AMM share state (yesShares, noShares) such that
// the LMSR cost function returns the target YES probability `p` for liquidity
// parameter `b`. Derived from the LMSR price relation:
//
//	p_yes = e^(qYes/b) / (e^(qYes/b) + e^(qNo/b))
//	⇒ qYes - qNo = b · ln(p / (1-p))
//
// We keep one side at zero and put the magnitude on the other side. This
// gives the AMM a "pre-loaded" position consistent with the displayed price
// without requiring any actual trades. p outside (0, 1) defaults to 50/50.
func initAMMShares(p, b float64) (yesShares, noShares float64) {
	if p <= 0 || p >= 1 || b <= 0 {
		return 0, 0
	}
	if p > 0.5 {
		return b * math.Log(p/(1-p)), 0
	}
	if p < 0.5 {
		return 0, b * math.Log((1-p)/p)
	}
	return 0, 0
}

// writeInitialState writes the post-CreateMarket fields (prices, AMM share
// state, image_path) directly. CreateMarket forces status=unopened and
// 50/50 prices and doesn't accept image_path; we patch that one row before
// transitioning the FSM.
func writeInitialState(ctx context.Context, db *sql.DB, marketID string, yesC, noC int, yesShares, noShares float64, imagePath string) error {
	_, err := db.ExecContext(ctx,
		`UPDATE prediction_markets
		   SET yes_price_points = $1,
		       no_price_points  = $2,
		       amm_yes_shares  = $3,
		       amm_no_shares   = $4,
		       image_path      = $5,
		       updated_at      = NOW()
		 WHERE id = $6`,
		yesC, noC, yesShares, noShares, nullStrSafe(imagePath), marketID,
	)
	return err
}

func nullStrSafe(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

// buildAttestation packs upstream metadata into the ResolveMarketRequest's
// AttestationData. Source identity (polymarket/kalshi/manifold) is OK in
// this audit-trail field — it's never user-visible.
func buildAttestation(m Market) json.RawMessage {
	if m.Resolution == nil {
		return json.RawMessage("{}")
	}
	payload := map[string]interface{}{
		"source":      m.Source,
		"external_id": m.ExternalID,
		"resolved_at": m.Resolution.ResolvedAt.UTC().Format(time.RFC3339),
		"outcome":     m.Resolution.Outcome,
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return json.RawMessage("{}")
	}
	return b
}

// generateTicker is the stable dedupe key for promotion. Uses external_hash
// (SHA-256 of source:external_id from phase 1) so re-syncs that rotate
// imported_markets.id (UUIDs) still hit the same ticker.
//
// Format: "IMP-" + first 8 hex chars of external_hash.
func generateTicker(m Market) string {
	hash := HashKey(m.Source, m.ExternalID)
	if len(hash) < 8 {
		return "IMP-" + hash
	}
	return "IMP-" + strings.ToUpper(hash[:8])
}

// clampPrices rounds floats to cents in [1,99] with sum=100. The CHECK
// constraint on prediction_markets enforces this; we satisfy it explicitly.
func clampPrices(prices []float64) (int, int) {
	if len(prices) < 1 {
		return 50, 50
	}
	yes := prices[0]
	if yes < 0.01 {
		yes = 0.01
	}
	if yes > 0.99 {
		yes = 0.99
	}
	yesC := int(yes*100 + 0.5)
	if yesC < 1 {
		yesC = 1
	}
	if yesC > 99 {
		yesC = 99
	}
	return yesC, 100 - yesC
}

// pickCloseAt returns the upstream's end_time when set, else 90 days out.
func pickCloseAt(t *time.Time) time.Time {
	if t != nil && t.After(time.Now().UTC()) {
		return *t
	}
	return time.Now().UTC().Add(90 * 24 * time.Hour)
}

// resolveCategoryIDs queries prediction_categories and returns slug → id.
func resolveCategoryIDs(ctx context.Context, db *sql.DB) (map[string]string, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT slug, id FROM prediction_categories WHERE slug = ANY($1)`,
		"{"+strings.Join(AllCategories, ",")+"}")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var slug, id string
		if err := rows.Scan(&slug, &id); err != nil {
			return nil, err
		}
		out[slug] = id
	}
	if rows.Err() != nil {
		return nil, rows.Err()
	}
	for _, slug := range AllCategories {
		if _, ok := out[slug]; !ok {
			return nil, fmt.Errorf("category %q not found in prediction_categories — run migrations 018 and 046", slug)
		}
	}
	return out, nil
}

// ensureSyntheticEvents inserts one synthetic event per category (idempotent
// via deterministic UUID + ON CONFLICT DO NOTHING). Returns category-slug → event-id.
//
// Synthetic event names are intentionally neutral ("Politics Markets" etc.)
// so audit logs and admin tools never display source-leak labels.
// syntheticEventTitles gives each per-category catch-all event an editorial
// desk name. These surface as Moments cluster headers on /predict — the old
// machine-made "<Category> Markets" read like database furniture. A slug
// without an entry falls back to that old pattern (a new category degrades,
// never breaks).
var syntheticEventTitles = map[string]string{
	"politics":      "Elections & Government",
	"economics":     "Economy & Rates",
	"sports":        "Games & Championships",
	"entertainment": "Screens & Stages",
	"esports":       "Esports & Arenas",
	"tech":          "Tech & AI",
	"crypto":        "Crypto & Chains",
	"general":       "The Big Board",
}

func ensureSyntheticEvents(ctx context.Context, db *sql.DB, catIDs map[string]string) (map[string]string, error) {
	out := map[string]string{}
	closeAt, _ := time.Parse(time.RFC3339, farFutureCloseAt)
	for slug, catID := range catIDs {
		title, ok := syntheticEventTitles[slug]
		if !ok {
			title = titleCase(slug) + " Markets"
		}
		// DO UPDATE (was DO NOTHING) so renamed desks propagate to events
		// that already exist — scoped to synthetic rows, which are ours.
		_, err := db.ExecContext(ctx,
			`INSERT INTO prediction_events
			   (id, title, description, category_id, status, close_at, metadata, is_synthetic)
			 VALUES (md5($1)::uuid, $2, $3, $4, 'open', $5, $6::jsonb, true)
			 ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title
			   WHERE prediction_events.is_synthetic = true`,
			"synthetic-event-"+slug,
			title,
			"",
			catID,
			closeAt,
			`{"synthetic": true}`,
		)
		if err != nil {
			return nil, fmt.Errorf("upsert synthetic event %s: %w", slug, err)
		}
		var eventID string
		err = db.QueryRowContext(ctx,
			`SELECT id FROM prediction_events WHERE id = md5($1)::uuid`,
			"synthetic-event-"+slug,
		).Scan(&eventID)
		if err != nil {
			return nil, fmt.Errorf("read back synthetic event %s: %w", slug, err)
		}
		out[slug] = eventID
	}
	return out, nil
}

// upstreamEventID is the deterministic prediction_events id for an upstream
// event, so every sync lands the same event on the same row.
func upstreamEventID(source, eventGroup string) string {
	return "upstream-event-" + strings.ToLower(strings.TrimSpace(source)) + ":" + strings.ToLower(strings.TrimSpace(eventGroup))
}

// ensureUpstreamEvent upserts the prediction_events row for an import's
// upstream event and returns its id. The title comes from the source's own
// event title, falling back to the market's; the close date is the latest
// of its markets'; the cover is the first market image that arrives. The
// metadata carries the event group (a slug or ticker, never a venue name)
// so back-office tools can tell imported events from editorial ones.
func ensureUpstreamEvent(ctx context.Context, db *sql.DB, m Market, categoryID, coverPath string) (string, error) {
	// The market's own title only seeds a brand-new event; on later syncs
	// only the source's event title may replace what is there.
	eventTitle := strings.TrimSpace(m.EventTitle)
	title := eventTitle
	if title == "" {
		title = strings.TrimSpace(m.Title)
	}
	closeAt := pickCloseAt(m.EndTime)
	metadata, _ := json.Marshal(map[string]any{"imported": true, "eventGroup": strings.TrimSpace(m.EventGroup)})
	var id string
	err := db.QueryRowContext(ctx,
		`INSERT INTO prediction_events
		   (id, title, description, category_id, status, open_at, close_at, cover_image_url, metadata, is_synthetic)
		 VALUES (md5($1)::uuid, $2, '', NULLIF($3, '')::uuid, 'open', now(), $4, NULLIF($5, ''), $6::jsonb, false)
		 ON CONFLICT (id) DO UPDATE SET
		   title           = COALESCE(NULLIF($7, ''), prediction_events.title),
		   close_at        = GREATEST(prediction_events.close_at, EXCLUDED.close_at),
		   category_id     = COALESCE(prediction_events.category_id, EXCLUDED.category_id),
		   cover_image_url = COALESCE(prediction_events.cover_image_url, EXCLUDED.cover_image_url),
		   updated_at      = now()
		 WHERE prediction_events.metadata ? 'eventGroup'
		 RETURNING id`,
		upstreamEventID(m.Source, m.EventGroup), title, categoryID, closeAt, coverPath, string(metadata), eventTitle,
	).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("upsert upstream event %q: %w", m.EventGroup, err)
	}
	return id, nil
}

// imagePathFor pulls the rehosted image path from imported_markets for the
// matching external_hash. If not found (rehost failed in phase 1), returns "".
func imagePathFor(ctx context.Context, db *sql.DB, m Market) string {
	hash := HashKey(m.Source, m.ExternalID)
	var path sql.NullString
	err := db.QueryRowContext(ctx,
		`SELECT image_path FROM imported_markets WHERE external_hash = $1`,
		hash,
	).Scan(&path)
	if err != nil || !path.Valid {
		return ""
	}
	return path.String
}

func titleCase(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}
