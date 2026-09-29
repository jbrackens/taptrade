package http

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	stdhttp "net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"taptrade/gateway/internal/leaderboards"
	"taptrade/gateway/internal/wallet"
	"taptrade/platform/transport/httpx"
)

type walletMutationRequest struct {
	UserID         string `json:"userId"`
	AmountPoints   int64  `json:"amountPoints"`
	IdempotencyKey string `json:"idempotencyKey"`
	Reason         string `json:"reason"`
}

type pointPackClaimRequest struct {
	PackID string `json:"packId"`
}

type pointPackDefinition struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Description   string `json:"description"`
	Unit          string `json:"unit"`
	AmountPoints  int64  `json:"amountPoints"`
	Enabled       bool   `json:"enabled"`
	ClaimableOnce bool   `json:"claimableOnce"`
	Claimed       bool   `json:"claimed"`
}

type missionClaimRequest struct {
	MissionID string `json:"missionId"`
}

type missionDefinition struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Description  string `json:"description"`
	Unit         string `json:"unit"`
	RewardPoints int64  `json:"rewardPoints"`
	Progress     int    `json:"progress"`
	Target       int    `json:"target"`
	Completed    bool   `json:"completed"`
	Claimed      bool   `json:"claimed"`
	Enabled      bool   `json:"enabled"`
}

type streakClaimRequest struct {
	StreakID string `json:"streakId"`
}

type streakDefinition struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Description   string `json:"description"`
	Unit          string `json:"unit"`
	RewardPoints  int64  `json:"rewardPoints"`
	CurrentStreak int    `json:"currentStreak"`
	Target        int    `json:"target"`
	Completed     bool   `json:"completed"`
	Claimed       bool   `json:"claimed"`
	Enabled       bool   `json:"enabled"`
}

type badgeDefinition struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	CosmeticID  string `json:"cosmeticId"`
	Earned      bool   `json:"earned"`
	Source      string `json:"source"`
}

type rewardGrantLimitStatus struct {
	Enabled         bool   `json:"enabled"`
	Unit            string `json:"unit"`
	LimitPoints     int64  `json:"limitPoints"`
	GrantedPoints   int64  `json:"grantedPoints"`
	RemainingPoints int64  `json:"remainingPoints"`
	WindowDate      string `json:"windowDate"`
	NextResetAt     string `json:"nextResetAt"`
}

func registerWalletRoutes(mux *stdhttp.ServeMux, service *wallet.Service, leaderboardServices ...*leaderboards.PredictService) {
	var leaderboardService *leaderboards.PredictService
	if len(leaderboardServices) > 0 {
		leaderboardService = leaderboardServices[0]
	}
	// Point movement happens through the in-process WalletAdapter used by the
	// order and settlement paths; admin balance adjustments go through the
	// admin-gated /api/v1/admin/wallet/{credit,debit} routes. There is
	// deliberately no public credit/debit endpoint — a session alone must
	// never be able to move points.
	mux.Handle("/api/v1/wallet/point-packs", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		userID := httpx.UserIDFromContext(r.Context())
		if userID == "" {
			return httpx.Unauthorized("authentication required")
		}
		packs := pointPackDefinitions(r.Context(), service, userID)
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
			"items": packs,
			"total": len(packs),
		})
	}))

	mux.Handle("/api/v1/wallet/point-packs/claim", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}
		userID := httpx.UserIDFromContext(r.Context())
		if userID == "" {
			return httpx.Unauthorized("authentication required")
		}
		var req pointPackClaimRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return httpx.BadRequest("invalid JSON payload", map[string]any{"field": "body"})
		}
		// One ledger read serves pack lookup (pinned 200-row window via
		// ledgerTail), the grant-limit gate, and the abuse replay check.
		ledger := service.Ledger(r.Context(), userID, 500)
		pack, ok := pointPackByIDFromLedger(ledgerTail(ledger, pointPackLedgerWindow), userID, req.PackID)
		if !ok {
			return httpx.NotFound("point pack not found")
		}
		if !pack.Enabled || pack.AmountPoints <= 0 {
			return httpx.Forbidden("point pack is not available")
		}
		now := time.Now().UTC()
		rewardKey := "point_pack:" + userID + ":" + pack.ID
		_, allowed := checkRewardGrantLimitFromLedger(ledger, rewardKey, pack.AmountPoints, now)
		if !allowed {
			return httpx.Forbidden("daily reward point limit reached")
		}
		if err := checkRewardAbuseClusters(r, service, userID, ledger, rewardKey, now); err != nil {
			return err
		}
		_, err := service.Credit(r.Context(), wallet.MutationRequest{
			UserID:         userID,
			AmountPoints:   pack.AmountPoints,
			IdempotencyKey: rewardKey,
			Reason:         "point_pack_grant",
		})
		if err != nil && !errors.Is(err, wallet.ErrIdempotencyConflict) {
			return mapWalletError(err)
		}
		pack.Claimed = true
		balance := service.Balance(r.Context(), userID)
		// Post-credit limit status must include the credit just written —
		// one fresh read.
		fresh := service.Ledger(r.Context(), userID, 500)
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
			"enabled":       true,
			"unit":          "PTS",
			"pack":          pack,
			"claimPoints":   pack.AmountPoints,
			"balancePoints": balance,
			"rewardLimit":   rewardLimitStatusFromLedger(fresh, now),
		})
	}))

	mux.Handle("/api/v1/wallet/missions", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		userID := httpx.UserIDFromContext(r.Context())
		if userID == "" {
			return httpx.Unauthorized("authentication required")
		}
		missions := missionDefinitions(r.Context(), service, leaderboardService, userID, time.Now().UTC())
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
			"items": missions,
			"total": len(missions),
		})
	}))

	mux.Handle("/api/v1/wallet/missions/claim", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}
		userID := httpx.UserIDFromContext(r.Context())
		if userID == "" {
			return httpx.Unauthorized("authentication required")
		}
		var req missionClaimRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return httpx.BadRequest("invalid JSON payload", map[string]any{"field": "body"})
		}
		now := time.Now().UTC()
		// One ledger read serves mission derivation, the grant-limit gate,
		// and the abuse replay check.
		ledger := service.Ledger(r.Context(), userID, 500)
		mission, ok := missionByIDFromLedger(r.Context(), ledger, leaderboardService, userID, req.MissionID, now)
		if !ok {
			return httpx.NotFound("mission not found")
		}
		if !mission.Enabled || mission.RewardPoints <= 0 {
			return httpx.Forbidden("mission is not available")
		}
		if !mission.Completed {
			return httpx.Forbidden("mission is not complete")
		}
		rewardKey := missionRewardKey(userID, mission.ID, now)
		_, allowed := checkRewardGrantLimitFromLedger(ledger, rewardKey, mission.RewardPoints, now)
		if !allowed {
			return httpx.Forbidden("daily reward point limit reached")
		}
		if err := checkRewardAbuseClusters(r, service, userID, ledger, rewardKey, now); err != nil {
			return err
		}
		_, err := service.Credit(r.Context(), wallet.MutationRequest{
			UserID:         userID,
			AmountPoints:   mission.RewardPoints,
			IdempotencyKey: rewardKey,
			Reason:         "mission_reward",
		})
		if err != nil && !errors.Is(err, wallet.ErrIdempotencyConflict) {
			return mapWalletError(err)
		}
		// Post-credit state (Claimed flag + limit totals including the new
		// credit) comes from one fresh read shared by both derivations.
		fresh := service.Ledger(r.Context(), userID, 500)
		mission, _ = missionByIDFromLedger(r.Context(), fresh, leaderboardService, userID, mission.ID, now)
		balance := service.Balance(r.Context(), userID)
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
			"enabled":       true,
			"unit":          "PTS",
			"mission":       mission,
			"claimPoints":   mission.RewardPoints,
			"balancePoints": balance,
			"rewardLimit":   rewardLimitStatusFromLedger(fresh, now),
		})
	}))

	mux.Handle("/api/v1/wallet/streaks", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		userID := httpx.UserIDFromContext(r.Context())
		if userID == "" {
			return httpx.Unauthorized("authentication required")
		}
		streaks := streakDefinitions(r.Context(), service, userID, time.Now().UTC())
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
			"items": streaks,
			"total": len(streaks),
		})
	}))

	mux.Handle("/api/v1/wallet/streaks/claim", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}
		userID := httpx.UserIDFromContext(r.Context())
		if userID == "" {
			return httpx.Unauthorized("authentication required")
		}
		var req streakClaimRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return httpx.BadRequest("invalid JSON payload", map[string]any{"field": "body"})
		}
		now := time.Now().UTC()
		// One ledger read serves streak derivation, the grant-limit gate,
		// and the abuse replay check.
		ledger := service.Ledger(r.Context(), userID, 500)
		streak, ok := streakByIDFromLedger(ledger, userID, req.StreakID, now)
		if !ok {
			return httpx.NotFound("streak not found")
		}
		if !streak.Enabled || streak.RewardPoints <= 0 {
			return httpx.Forbidden("streak reward is not available")
		}
		if !streak.Completed {
			return httpx.Forbidden("streak is not complete")
		}
		rewardKey := streakRewardKey(userID, streak.ID)
		_, allowed := checkRewardGrantLimitFromLedger(ledger, rewardKey, streak.RewardPoints, now)
		if !allowed {
			return httpx.Forbidden("daily reward point limit reached")
		}
		if err := checkRewardAbuseClusters(r, service, userID, ledger, rewardKey, now); err != nil {
			return err
		}
		_, err := service.Credit(r.Context(), wallet.MutationRequest{
			UserID:         userID,
			AmountPoints:   streak.RewardPoints,
			IdempotencyKey: rewardKey,
			Reason:         "streak_reward",
		})
		if err != nil && !errors.Is(err, wallet.ErrIdempotencyConflict) {
			return mapWalletError(err)
		}
		// Post-credit state (Claimed flag + limit totals including the new
		// credit) comes from one fresh read shared by both derivations.
		fresh := service.Ledger(r.Context(), userID, 500)
		streak, _ = streakByIDFromLedger(fresh, userID, streak.ID, now)
		balance := service.Balance(r.Context(), userID)
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
			"enabled":       true,
			"unit":          "PTS",
			"streak":        streak,
			"claimPoints":   streak.RewardPoints,
			"balancePoints": balance,
			"rewardLimit":   rewardLimitStatusFromLedger(fresh, now),
		})
	}))

	mux.Handle("/api/v1/wallet/badges", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		userID := httpx.UserIDFromContext(r.Context())
		if userID == "" {
			return httpx.Unauthorized("authentication required")
		}
		badges := badgeDefinitions(r.Context(), service, leaderboardService, userID)
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
			"items": badges,
			"total": len(badges),
		})
	}))

	mux.Handle("/api/v1/wallet/reward-limits", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		userID := httpx.UserIDFromContext(r.Context())
		if userID == "" {
			return httpx.Unauthorized("authentication required")
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, rewardLimitStatus(r.Context(), service, userID, time.Now().UTC()))
	}))

	mux.Handle("/api/v1/wallet/", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}

		path := strings.TrimPrefix(r.URL.Path, "/api/v1/wallet/")
		if path == "" {
			return httpx.NotFound("wallet not found")
		}

		parts := strings.Split(path, "/")
		userID := parts[0]
		if userID == "" {
			return httpx.NotFound("wallet not found")
		}

		// Enforce auth context: players can only access their own wallet. Deny on
		// an empty session identity rather than skipping the check (fail closed,
		// not open — SECURITY-REVIEW #14).
		authUserID := httpx.UserIDFromContext(r.Context())
		if authUserID == "" {
			return httpx.Unauthorized("authentication required")
		}
		if userID != authUserID && httpx.RoleFromContext(r.Context()) != "admin" {
			return httpx.Forbidden("cannot access another user's wallet")
		}

		if len(parts) == 2 && parts[1] == "breakdown" {
			breakdown := service.BalanceWithBreakdown(r.Context(), userID)
			return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
				"unit":        "PTS",
				"basePoints":  breakdown.RealMoneyPoints,
				"bonusPoints": breakdown.BonusFundPoints,
				"totalPoints": breakdown.TotalPoints,
			})
		}

		if len(parts) == 2 && parts[1] == "ledger" {
			limit := 50
			if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
				parsed, err := strconv.Atoi(raw)
				if err != nil || parsed <= 0 {
					return httpx.BadRequest("limit must be a positive integer", map[string]any{"field": "limit", "value": raw})
				}
				// Ceiling: the ledger is the busiest append-only table and the
				// query is unindexed before migration 032; an unclamped limit
				// is the worst per-request scan a logged-in user can trigger
				// (audit PERF-01).
				if parsed > 500 {
					parsed = 500
				}
				limit = parsed
			}

			entries := service.Ledger(r.Context(), userID, limit)
			return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
				"userId": userID,
				"items":  walletLedgerEntryPayloads(entries),
				"total":  len(entries),
			})
		}

		if len(parts) == 1 {
			// Balance + available (balance - held reservations) + reserved in
			// one wallet read; the previous Balance/AvailableBalance pair cost
			// three queries on this frequently-polled endpoint.
			summary := service.BalanceSummary(r.Context(), userID)
			return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
				"userId":          userID,
				"unit":            "PTS",
				"balancePoints":   summary.BalancePoints,
				"availablePoints": summary.AvailablePoints,
				"reservedPoints":  summary.ReservedPoints,
			})
		}

		return httpx.NotFound("wallet resource not found")
	}))

	// Gameplay-point starter grant (faucet). OFF by default — active only when
	// STARTER_GRANT_CENTS > 0, which a launch deployment can leave at 0. This
	// is the one deliberate, bounded exception to "a session never moves points"
	// above: it credits ONLY the session user, the amount is operator-configured
	// (not user-supplied), and it is idempotent (one grant per user via the key
	// starter_grant:<uid>). It makes a freshly-registered player immediately
	// tradeable in points-only beta when configured.
	mux.Handle("/api/v1/wallet/starter-grant", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}
		userID := httpx.UserIDFromContext(r.Context())
		if userID == "" {
			return httpx.Forbidden("authentication required")
		}
		grant := starterGrantPoints()
		if grant <= 0 {
			balance := service.Balance(r.Context(), userID)
			return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
				"enabled":       false,
				"unit":          "PTS",
				"balancePoints": balance,
			})
		}
		// Fresh-vs-replay: the client claims on every new session, but only a
		// grant that lands NOW deserves a welcome moment in the UI. If the
		// pre-check errors, claim "already had it" — the credit below still
		// dedupes, and the UI must never celebrate a replay.
		grantKey := "starter_grant:" + userID
		already, lookupErr := service.HasCredit(r.Context(), userID, grantKey)
		if lookupErr != nil {
			already = true
		}
		grantReq := wallet.MutationRequest{
			UserID:         userID,
			AmountPoints:   grant,
			IdempotencyKey: grantKey,
			Reason:         "starter point grant",
		}
		_, err := service.Credit(r.Context(), grantReq)
		// Concurrent duplicate claims (double tab, dev double-effects) can
		// mutually abort under SERIALIZABLE before either row commits — the
		// replay recovery inside Credit finds nothing to return. One clean
		// retry resolves to the idempotent outcome whichever request won.
		if err != nil && !errors.Is(err, wallet.ErrIdempotencyConflict) {
			_, err = service.Credit(r.Context(), grantReq)
		}
		// An idempotency conflict means the user already claimed their grant
		// (same key, since-changed amount). That is success, not an error —
		// they keep their original grant.
		if err != nil && !errors.Is(err, wallet.ErrIdempotencyConflict) {
			return mapWalletError(err)
		}
		balance := service.Balance(r.Context(), userID)
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
			"enabled":       true,
			"unit":          "PTS",
			"granted":       err == nil && !already,
			"grantPoints":   grant,
			"balancePoints": balance,
		})
	}))

	// Daily gameplay-point claim. It mirrors the starter grant safety posture:
	// the session chooses neither user nor amount, the faucet can be disabled by
	// configuration, and the idempotency key scopes claims to one UTC day.
	mux.Handle("/api/v1/wallet/daily-claim", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}
		userID := httpx.UserIDFromContext(r.Context())
		if userID == "" {
			return httpx.Forbidden("authentication required")
		}
		now := time.Now().UTC()
		claimDate := now.Format("2006-01-02")
		nextClaimAt := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339)
		claim := dailyClaimPoints()
		if claim <= 0 {
			balance := service.Balance(r.Context(), userID)
			return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
				"enabled":        false,
				"unit":           "PTS",
				"claimedForDate": claimDate,
				"nextClaimAt":    nextClaimAt,
				"balancePoints":  balance,
				"rewardLimit":    rewardLimitStatus(r.Context(), service, userID, now),
			})
		}
		rewardKey := "daily_claim:" + userID + ":" + claimDate
		// One ledger read serves the grant-limit gate and abuse replay check.
		ledger := service.Ledger(r.Context(), userID, 500)
		_, allowed := checkRewardGrantLimitFromLedger(ledger, rewardKey, claim, now)
		if !allowed {
			return httpx.Forbidden("daily reward point limit reached")
		}
		if err := checkRewardAbuseClusters(r, service, userID, ledger, rewardKey, now); err != nil {
			return err
		}
		_, err := service.Credit(r.Context(), wallet.MutationRequest{
			UserID:         userID,
			AmountPoints:   claim,
			IdempotencyKey: rewardKey,
			Reason:         "daily_claim",
		})
		if err != nil && !errors.Is(err, wallet.ErrIdempotencyConflict) {
			return mapWalletError(err)
		}
		balance := service.Balance(r.Context(), userID)
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
			"enabled":        true,
			"unit":           "PTS",
			"claimPoints":    claim,
			"claimedForDate": claimDate,
			"nextClaimAt":    nextClaimAt,
			"balancePoints":  balance,
			"rewardLimit":    rewardLimitStatus(r.Context(), service, userID, now),
		})
	}))
}

func walletLedgerEntryPayloads(entries []wallet.LedgerEntry) []map[string]any {
	items := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		items = append(items, walletLedgerEntryPayload(entry))
	}
	return items
}

func walletLedgerEntryPayload(entry wallet.LedgerEntry) map[string]any {
	return map[string]any{
		"entryId":         entry.EntryID,
		"userId":          entry.UserID,
		"type":            entry.Type,
		"unit":            "PTS",
		"amountPoints":    entry.AmountPoints,
		"balancePoints":   entry.BalancePoints,
		"idempotencyKey":  entry.IdempotencyKey,
		"reason":          redactLaunchProhibitedUserText(entry.Reason),
		"transactionTime": entry.TransactionTime,
	}
}

// starterGrantPoints reads the gameplay-point starter-grant amount from the
// environment. 0 (the default, and any non-numeric/negative value) disables the
// faucet — which is the required posture for a real-value deployment.
func starterGrantPoints() int64 {
	raw := strings.TrimSpace(os.Getenv("STARTER_GRANT_CENTS"))
	if raw == "" {
		return 0
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n < 0 {
		return 0
	}
	return n
}

func dailyClaimPoints() int64 {
	raw := strings.TrimSpace(os.Getenv("DAILY_CLAIM_CENTS"))
	if raw == "" {
		return 0
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n < 0 {
		return 0
	}
	return n
}

// pointPackLedgerWindow is the claimed-state scan depth point packs have
// always used — narrower than the 500-row window the other reward surfaces
// read. Pinned so the shared-fetch claim path reproduces it exactly via
// ledgerTail.
const pointPackLedgerWindow = 200

func pointPackDefinitions(ctx context.Context, service *wallet.Service, userID string) []pointPackDefinition {
	return pointPackDefinitionsFromLedger(service.Ledger(ctx, userID, pointPackLedgerWindow), userID)
}

// pointPackDefinitionsFromLedger derives pack state from an already-fetched
// ledger window so claim requests can share ONE ledger read across pack
// lookup, grant-limit gate, and abuse replay check. Callers holding a wider
// window must pass ledgerTail(entries, pointPackLedgerWindow) to keep the
// pinned 200-row claimed-state semantics.
func pointPackDefinitionsFromLedger(ledger []wallet.LedgerEntry, userID string) []pointPackDefinition {
	defs := []struct {
		id          string
		name        string
		description string
		env         string
	}{
		{
			id:          "starter_boost",
			name:        "Starter boost",
			description: "One-time Clout pack for trying more predictions.",
			env:         "POINT_PACK_STARTER_BOOST_CENTS",
		},
		{
			id:          "market_explorer",
			name:        "Market explorer",
			description: "One-time Clout pack for exploring more categories.",
			env:         "POINT_PACK_MARKET_EXPLORER_CENTS",
		},
	}
	packs := make([]pointPackDefinition, 0, len(defs))
	for _, def := range defs {
		amount := pointPackAmountPoints(def.env)
		claimed := ledgerHasIdempotencyKey(ledger, "point_pack:"+userID+":"+def.id)
		packs = append(packs, pointPackDefinition{
			ID:            def.id,
			Name:          def.name,
			Description:   def.description,
			Unit:          "PTS",
			AmountPoints:  amount,
			Enabled:       amount > 0,
			ClaimableOnce: true,
			Claimed:       claimed,
		})
	}
	return packs
}

func pointPackByIDFromLedger(ledger []wallet.LedgerEntry, userID string, packID string) (pointPackDefinition, bool) {
	normalized := strings.TrimSpace(packID)
	for _, pack := range pointPackDefinitionsFromLedger(ledger, userID) {
		if pack.ID == normalized {
			return pack, true
		}
	}
	return pointPackDefinition{}, false
}

// ledgerTail returns the most recent n entries of an oldest-first ledger
// window — byte-for-byte what a direct service.Ledger(ctx, userID, n) fetch
// would return, given a wider window fetched once for the whole request.
func ledgerTail(entries []wallet.LedgerEntry, n int) []wallet.LedgerEntry {
	if n <= 0 || len(entries) <= n {
		return entries
	}
	return entries[len(entries)-n:]
}

func pointPackAmountPoints(envKey string) int64 {
	raw := strings.TrimSpace(os.Getenv(envKey))
	if raw == "" {
		return 0
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n < 0 {
		return 0
	}
	return n
}

func missionDefinitions(ctx context.Context, service *wallet.Service, leaderboardService *leaderboards.PredictService, userID string, now time.Time) []missionDefinition {
	return missionDefinitionsFromLedger(ctx, service.Ledger(ctx, userID, 500), leaderboardService, userID, now)
}

// missionDefinitionsFromLedger derives mission state from an already-fetched
// 500-row ledger window; claim requests fetch the ledger once and share it
// with the grant-limit and abuse checks instead of re-reading per derivation.
// ctx is retained for the (non-ledger) leaderboard standing lookup.
func missionDefinitionsFromLedger(ctx context.Context, ledger []wallet.LedgerEntry, leaderboardService *leaderboards.PredictService, userID string, now time.Time) []missionDefinition {
	date := now.UTC().Format("2006-01-02")
	dailyClaimed := ledgerHasIdempotencyKey(ledger, "daily_claim:"+userID+":"+date)
	missionClaimed := ledgerHasIdempotencyKey(ledger, missionRewardKey(userID, "daily_check_in", now))
	reward := missionRewardPoints("MISSION_DAILY_CHECK_IN_REWARD_CENTS")
	progress := 0
	if dailyClaimed {
		progress = 1
	}
	firstPredictionComplete := ledgerHasPredictionOrderEvidence(ledger)
	firstPredictionClaimed := ledgerHasIdempotencyKey(ledger, missionRewardKey(userID, "first_prediction_order", now))
	firstPredictionReward := missionRewardPoints("MISSION_FIRST_PREDICTION_REWARD_CENTS")
	firstPredictionProgress := 0
	if firstPredictionComplete {
		firstPredictionProgress = 1
	}
	threePredictionCount := ledgerPredictionOrderEvidenceCount(ledger)
	threePredictionComplete := threePredictionCount >= 3
	threePredictionClaimed := ledgerHasIdempotencyKey(ledger, missionRewardKey(userID, "three_predictions", now))
	threePredictionReward := missionRewardPoints("MISSION_THREE_PREDICTIONS_REWARD_CENTS")
	threePredictionProgress := threePredictionCount
	if threePredictionProgress > 3 {
		threePredictionProgress = 3
	}
	fivePredictionComplete := threePredictionCount >= 5
	fivePredictionClaimed := ledgerHasIdempotencyKey(ledger, missionRewardKey(userID, "five_predictions", now))
	fivePredictionReward := missionRewardPoints("MISSION_FIVE_PREDICTIONS_REWARD_CENTS")
	fivePredictionProgress := threePredictionCount
	if fivePredictionProgress > 5 {
		fivePredictionProgress = 5
	}
	tenPredictionComplete := threePredictionCount >= 10
	tenPredictionClaimed := ledgerHasIdempotencyKey(ledger, missionRewardKey(userID, "ten_predictions", now))
	tenPredictionReward := missionRewardPoints("MISSION_TEN_PREDICTIONS_REWARD_CENTS")
	tenPredictionProgress := threePredictionCount
	if tenPredictionProgress > 10 {
		tenPredictionProgress = 10
	}
	settledResultComplete := ledgerHasSettlementPayoutEvidence(ledger)
	settledResultClaimed := ledgerHasIdempotencyKey(ledger, missionRewardKey(userID, "settled_result", now))
	settledResultReward := missionRewardPoints("MISSION_SETTLED_RESULT_REWARD_CENTS")
	settledResultProgress := 0
	if settledResultComplete {
		settledResultProgress = 1
	}
	threeSettledResultCount := ledgerSettlementPayoutEvidenceCount(ledger)
	threeSettledResultComplete := threeSettledResultCount >= 3
	threeSettledResultClaimed := ledgerHasIdempotencyKey(ledger, missionRewardKey(userID, "three_settled_results", now))
	threeSettledResultReward := missionRewardPoints("MISSION_THREE_SETTLED_RESULTS_REWARD_CENTS")
	threeSettledResultProgress := threeSettledResultCount
	if threeSettledResultProgress > 3 {
		threeSettledResultProgress = 3
	}
	fiveSettledResultComplete := threeSettledResultCount >= 5
	fiveSettledResultClaimed := ledgerHasIdempotencyKey(ledger, missionRewardKey(userID, "five_settled_results", now))
	fiveSettledResultReward := missionRewardPoints("MISSION_FIVE_SETTLED_RESULTS_REWARD_CENTS")
	fiveSettledResultProgress := threeSettledResultCount
	if fiveSettledResultProgress > 5 {
		fiveSettledResultProgress = 5
	}
	tenSettledResultComplete := threeSettledResultCount >= 10
	tenSettledResultClaimed := ledgerHasIdempotencyKey(ledger, missionRewardKey(userID, "ten_settled_results", now))
	tenSettledResultReward := missionRewardPoints("MISSION_TEN_SETTLED_RESULTS_REWARD_CENTS")
	tenSettledResultProgress := threeSettledResultCount
	if tenSettledResultProgress > 10 {
		tenSettledResultProgress = 10
	}
	weeklyCheckInStreak := dailyClaimStreakDays(ledger, userID, now)
	weeklyCheckInComplete := weeklyCheckInStreak >= 7
	weeklyCheckInClaimed := ledgerHasIdempotencyKey(ledger, missionRewardKey(userID, "weekly_check_in", now))
	weeklyCheckInReward := missionRewardPoints("MISSION_WEEKLY_CHECK_IN_REWARD_CENTS")
	weeklyCheckInProgress := weeklyCheckInStreak
	if weeklyCheckInProgress > 7 {
		weeklyCheckInProgress = 7
	}
	monthlyCheckInComplete := weeklyCheckInStreak >= 30
	monthlyCheckInClaimed := ledgerHasIdempotencyKey(ledger, missionRewardKey(userID, "monthly_check_in", now))
	monthlyCheckInReward := missionRewardPoints("MISSION_MONTHLY_CHECK_IN_REWARD_CENTS")
	monthlyCheckInProgress := weeklyCheckInStreak
	if monthlyCheckInProgress > 30 {
		monthlyCheckInProgress = 30
	}
	seasonalCheckInComplete := weeklyCheckInStreak >= 60
	seasonalCheckInClaimed := ledgerHasIdempotencyKey(ledger, missionRewardKey(userID, "seasonal_check_in", now))
	seasonalCheckInReward := missionRewardPoints("MISSION_SEASONAL_CHECK_IN_REWARD_CENTS")
	seasonalCheckInProgress := weeklyCheckInStreak
	if seasonalCheckInProgress > 60 {
		seasonalCheckInProgress = 60
	}
	quarterlyCheckInComplete := weeklyCheckInStreak >= 90
	quarterlyCheckInClaimed := ledgerHasIdempotencyKey(ledger, missionRewardKey(userID, "quarterly_check_in", now))
	quarterlyCheckInReward := missionRewardPoints("MISSION_QUARTERLY_CHECK_IN_REWARD_CENTS")
	quarterlyCheckInProgress := weeklyCheckInStreak
	if quarterlyCheckInProgress > 90 {
		quarterlyCheckInProgress = 90
	}
	leaderboardStandingCount := leaderboardEvidenceCount(ctx, leaderboardService, userID)
	leaderboardDebutComplete := leaderboardStandingCount > 0
	leaderboardDebutClaimed := ledgerHasIdempotencyKey(ledger, missionRewardKey(userID, "leaderboard_debut", now))
	leaderboardDebutReward := missionRewardPoints("MISSION_LEADERBOARD_DEBUT_REWARD_CENTS")
	leaderboardDebutProgress := leaderboardStandingCount
	if leaderboardDebutProgress > 1 {
		leaderboardDebutProgress = 1
	}
	return []missionDefinition{
		{
			ID:           "daily_check_in",
			Name:         "Daily check-in",
			Description:  "Claim today's Clout to complete this mission.",
			Unit:         "PTS",
			RewardPoints: reward,
			Progress:     progress,
			Target:       1,
			Completed:    dailyClaimed,
			Claimed:      missionClaimed,
			Enabled:      reward > 0,
		},
		{
			ID:           "first_prediction_order",
			Name:         "First prediction",
			Description:  "Place a prediction order to complete this one-time mission.",
			Unit:         "PTS",
			RewardPoints: firstPredictionReward,
			Progress:     firstPredictionProgress,
			Target:       1,
			Completed:    firstPredictionComplete,
			Claimed:      firstPredictionClaimed,
			Enabled:      firstPredictionReward > 0,
		},
		{
			ID:           "three_predictions",
			Name:         "Three predictions",
			Description:  "Place three prediction orders to complete this one-time mission.",
			Unit:         "PTS",
			RewardPoints: threePredictionReward,
			Progress:     threePredictionProgress,
			Target:       3,
			Completed:    threePredictionComplete,
			Claimed:      threePredictionClaimed,
			Enabled:      threePredictionReward > 0,
		},
		{
			ID:           "five_predictions",
			Name:         "Five predictions",
			Description:  "Place five prediction orders to complete this one-time mission.",
			Unit:         "PTS",
			RewardPoints: fivePredictionReward,
			Progress:     fivePredictionProgress,
			Target:       5,
			Completed:    fivePredictionComplete,
			Claimed:      fivePredictionClaimed,
			Enabled:      fivePredictionReward > 0,
		},
		{
			ID:           "ten_predictions",
			Name:         "Ten predictions",
			Description:  "Place ten prediction orders to complete this one-time mission.",
			Unit:         "PTS",
			RewardPoints: tenPredictionReward,
			Progress:     tenPredictionProgress,
			Target:       10,
			Completed:    tenPredictionComplete,
			Claimed:      tenPredictionClaimed,
			Enabled:      tenPredictionReward > 0,
		},
		{
			ID:           "settled_result",
			Name:         "Settled result",
			Description:  "Receive a prediction settlement result to complete this one-time mission.",
			Unit:         "PTS",
			RewardPoints: settledResultReward,
			Progress:     settledResultProgress,
			Target:       1,
			Completed:    settledResultComplete,
			Claimed:      settledResultClaimed,
			Enabled:      settledResultReward > 0,
		},
		{
			ID:           "three_settled_results",
			Name:         "Three settled results",
			Description:  "Receive three prediction settlement results to complete this one-time mission.",
			Unit:         "PTS",
			RewardPoints: threeSettledResultReward,
			Progress:     threeSettledResultProgress,
			Target:       3,
			Completed:    threeSettledResultComplete,
			Claimed:      threeSettledResultClaimed,
			Enabled:      threeSettledResultReward > 0,
		},
		{
			ID:           "five_settled_results",
			Name:         "Five settled results",
			Description:  "Receive five prediction settlement results to complete this one-time mission.",
			Unit:         "PTS",
			RewardPoints: fiveSettledResultReward,
			Progress:     fiveSettledResultProgress,
			Target:       5,
			Completed:    fiveSettledResultComplete,
			Claimed:      fiveSettledResultClaimed,
			Enabled:      fiveSettledResultReward > 0,
		},
		{
			ID:           "ten_settled_results",
			Name:         "Ten settled results",
			Description:  "Receive ten prediction settlement results to complete this one-time mission.",
			Unit:         "PTS",
			RewardPoints: tenSettledResultReward,
			Progress:     tenSettledResultProgress,
			Target:       10,
			Completed:    tenSettledResultComplete,
			Claimed:      tenSettledResultClaimed,
			Enabled:      tenSettledResultReward > 0,
		},
		{
			ID:           "weekly_check_in",
			Name:         "Weekly check-in",
			Description:  "Claim your daily Clout seven days in a row to complete this one-time mission.",
			Unit:         "PTS",
			RewardPoints: weeklyCheckInReward,
			Progress:     weeklyCheckInProgress,
			Target:       7,
			Completed:    weeklyCheckInComplete,
			Claimed:      weeklyCheckInClaimed,
			Enabled:      weeklyCheckInReward > 0,
		},
		{
			ID:           "monthly_check_in",
			Name:         "Monthly check-in",
			Description:  "Claim your daily Clout thirty days in a row to complete this one-time mission.",
			Unit:         "PTS",
			RewardPoints: monthlyCheckInReward,
			Progress:     monthlyCheckInProgress,
			Target:       30,
			Completed:    monthlyCheckInComplete,
			Claimed:      monthlyCheckInClaimed,
			Enabled:      monthlyCheckInReward > 0,
		},
		{
			ID:           "seasonal_check_in",
			Name:         "Seasonal check-in",
			Description:  "Claim your daily Clout sixty days in a row to complete this one-time mission.",
			Unit:         "PTS",
			RewardPoints: seasonalCheckInReward,
			Progress:     seasonalCheckInProgress,
			Target:       60,
			Completed:    seasonalCheckInComplete,
			Claimed:      seasonalCheckInClaimed,
			Enabled:      seasonalCheckInReward > 0,
		},
		{
			ID:           "quarterly_check_in",
			Name:         "Quarterly check-in",
			Description:  "Claim your daily Clout ninety days in a row to complete this one-time mission.",
			Unit:         "PTS",
			RewardPoints: quarterlyCheckInReward,
			Progress:     quarterlyCheckInProgress,
			Target:       90,
			Completed:    quarterlyCheckInComplete,
			Claimed:      quarterlyCheckInClaimed,
			Enabled:      quarterlyCheckInReward > 0,
		},
		{
			ID:           "leaderboard_debut",
			Name:         "Leaderboard debut",
			Description:  "Appear on a prediction leaderboard to complete this one-time mission.",
			Unit:         "PTS",
			RewardPoints: leaderboardDebutReward,
			Progress:     leaderboardDebutProgress,
			Target:       1,
			Completed:    leaderboardDebutComplete,
			Claimed:      leaderboardDebutClaimed,
			Enabled:      leaderboardDebutReward > 0,
		},
	}
}

func missionByIDFromLedger(ctx context.Context, ledger []wallet.LedgerEntry, leaderboardService *leaderboards.PredictService, userID string, missionID string, now time.Time) (missionDefinition, bool) {
	normalized := strings.TrimSpace(missionID)
	for _, mission := range missionDefinitionsFromLedger(ctx, ledger, leaderboardService, userID, now) {
		if mission.ID == normalized {
			return mission, true
		}
	}
	return missionDefinition{}, false
}

func missionRewardKey(userID, missionID string, now time.Time) string {
	if missionID == "first_prediction_order" || missionID == "three_predictions" || missionID == "five_predictions" || missionID == "ten_predictions" || missionID == "settled_result" || missionID == "three_settled_results" || missionID == "five_settled_results" || missionID == "ten_settled_results" || missionID == "weekly_check_in" || missionID == "monthly_check_in" || missionID == "seasonal_check_in" || missionID == "quarterly_check_in" || missionID == "leaderboard_debut" {
		return "mission_reward:" + userID + ":" + missionID
	}
	return "mission_reward:" + userID + ":" + missionID + ":" + now.UTC().Format("2006-01-02")
}

func leaderboardEvidenceCount(ctx context.Context, leaderboardService *leaderboards.PredictService, userID string) int {
	if leaderboardService == nil {
		return 0
	}
	entries, err := leaderboardService.UserStanding(ctx, userID)
	if err != nil {
		return 0
	}
	return len(entries)
}

func ledgerHasIdempotencyKey(entries []wallet.LedgerEntry, key string) bool {
	for _, entry := range entries {
		if entry.IdempotencyKey == key {
			return true
		}
	}
	return false
}

func missionRewardPoints(envKey string) int64 {
	raw := strings.TrimSpace(os.Getenv(envKey))
	if raw == "" {
		return 0
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n < 0 {
		return 0
	}
	return n
}

func streakDefinitions(ctx context.Context, service *wallet.Service, userID string, now time.Time) []streakDefinition {
	return streakDefinitionsFromLedger(service.Ledger(ctx, userID, 500), userID, now)
}

// streakDefinitionsFromLedger derives streak state from an already-fetched
// 500-row ledger window (see missionDefinitionsFromLedger).
func streakDefinitionsFromLedger(ledger []wallet.LedgerEntry, userID string, now time.Time) []streakDefinition {
	currentStreak := dailyClaimStreakDays(ledger, userID, now)
	threeDayReward := streakRewardPoints("STREAK_DAILY_3_REWARD_CENTS")
	weeklyReward := streakRewardPoints("STREAK_DAILY_7_REWARD_CENTS")
	fortnightReward := streakRewardPoints("STREAK_DAILY_14_REWARD_CENTS")
	monthlyReward := streakRewardPoints("STREAK_DAILY_30_REWARD_CENTS")
	doubleMonthlyReward := streakRewardPoints("STREAK_DAILY_60_REWARD_CENTS")
	quarterlyReward := streakRewardPoints("STREAK_DAILY_90_REWARD_CENTS")
	return []streakDefinition{
		{
			ID:            "daily_3",
			Name:          "3-day check-in streak",
			Description:   "Claim your daily Clout three days in a row.",
			Unit:          "PTS",
			RewardPoints:  threeDayReward,
			CurrentStreak: currentStreak,
			Target:        3,
			Completed:     currentStreak >= 3,
			Claimed:       ledgerHasIdempotencyKey(ledger, streakRewardKey(userID, "daily_3")),
			Enabled:       threeDayReward > 0,
		},
		{
			ID:            "daily_7",
			Name:          "7-day check-in streak",
			Description:   "Claim your daily Clout seven days in a row.",
			Unit:          "PTS",
			RewardPoints:  weeklyReward,
			CurrentStreak: currentStreak,
			Target:        7,
			Completed:     currentStreak >= 7,
			Claimed:       ledgerHasIdempotencyKey(ledger, streakRewardKey(userID, "daily_7")),
			Enabled:       weeklyReward > 0,
		},
		{
			ID:            "daily_14",
			Name:          "14-day check-in streak",
			Description:   "Claim your daily Clout fourteen days in a row.",
			Unit:          "PTS",
			RewardPoints:  fortnightReward,
			CurrentStreak: currentStreak,
			Target:        14,
			Completed:     currentStreak >= 14,
			Claimed:       ledgerHasIdempotencyKey(ledger, streakRewardKey(userID, "daily_14")),
			Enabled:       fortnightReward > 0,
		},
		{
			ID:            "daily_30",
			Name:          "30-day check-in streak",
			Description:   "Claim your daily Clout thirty days in a row.",
			Unit:          "PTS",
			RewardPoints:  monthlyReward,
			CurrentStreak: currentStreak,
			Target:        30,
			Completed:     currentStreak >= 30,
			Claimed:       ledgerHasIdempotencyKey(ledger, streakRewardKey(userID, "daily_30")),
			Enabled:       monthlyReward > 0,
		},
		{
			ID:            "daily_60",
			Name:          "60-day check-in streak",
			Description:   "Claim your daily Clout sixty days in a row.",
			Unit:          "PTS",
			RewardPoints:  doubleMonthlyReward,
			CurrentStreak: currentStreak,
			Target:        60,
			Completed:     currentStreak >= 60,
			Claimed:       ledgerHasIdempotencyKey(ledger, streakRewardKey(userID, "daily_60")),
			Enabled:       doubleMonthlyReward > 0,
		},
		{
			ID:            "daily_90",
			Name:          "90-day check-in streak",
			Description:   "Claim your daily Clout ninety days in a row.",
			Unit:          "PTS",
			RewardPoints:  quarterlyReward,
			CurrentStreak: currentStreak,
			Target:        90,
			Completed:     currentStreak >= 90,
			Claimed:       ledgerHasIdempotencyKey(ledger, streakRewardKey(userID, "daily_90")),
			Enabled:       quarterlyReward > 0,
		},
	}
}

func streakByIDFromLedger(ledger []wallet.LedgerEntry, userID string, streakID string, now time.Time) (streakDefinition, bool) {
	normalized := strings.TrimSpace(streakID)
	for _, streak := range streakDefinitionsFromLedger(ledger, userID, now) {
		if streak.ID == normalized {
			return streak, true
		}
	}
	return streakDefinition{}, false
}

func streakRewardKey(userID, streakID string) string {
	return "streak_reward:" + userID + ":" + streakID
}

func dailyClaimStreakDays(entries []wallet.LedgerEntry, userID string, now time.Time) int {
	claimedDates := make(map[string]bool)
	prefix := "daily_claim:" + userID + ":"
	for _, entry := range entries {
		if !strings.HasPrefix(entry.IdempotencyKey, prefix) {
			continue
		}
		date := strings.TrimPrefix(entry.IdempotencyKey, prefix)
		if _, err := time.Parse("2006-01-02", date); err == nil {
			claimedDates[date] = true
		}
	}
	streak := 0
	for day := now.UTC(); ; day = day.AddDate(0, 0, -1) {
		if !claimedDates[day.Format("2006-01-02")] {
			return streak
		}
		streak++
	}
}

func streakRewardPoints(envKey string) int64 {
	raw := strings.TrimSpace(os.Getenv(envKey))
	if raw == "" {
		return 0
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n < 0 {
		return 0
	}
	return n
}

func badgeDefinitions(ctx context.Context, service *wallet.Service, leaderboardService *leaderboards.PredictService, userID string) []badgeDefinition {
	ledger := service.Ledger(ctx, userID, 500)
	hasDailyClaim := ledgerHasIdempotencyPrefix(ledger, "daily_claim:"+userID+":")
	hasMissionReward := ledgerHasIdempotencyPrefix(ledger, "mission_reward:"+userID+":")
	hasStreakReward := ledgerHasIdempotencyKey(ledger, streakRewardKey(userID, "daily_3"))
	hasWeeklyStreakReward := ledgerHasIdempotencyKey(ledger, streakRewardKey(userID, "daily_7"))
	hasFortnightStreakReward := ledgerHasIdempotencyKey(ledger, streakRewardKey(userID, "daily_14"))
	hasMonthlyStreakReward := ledgerHasIdempotencyKey(ledger, streakRewardKey(userID, "daily_30"))
	hasDoubleMonthlyStreakReward := ledgerHasIdempotencyKey(ledger, streakRewardKey(userID, "daily_60"))
	hasQuarterlyStreakReward := ledgerHasIdempotencyKey(ledger, streakRewardKey(userID, "daily_90"))
	hasMonthlyCheckInMissionReward := ledgerHasIdempotencyKey(ledger, missionRewardKey(userID, "monthly_check_in", time.Now().UTC()))
	hasSeasonalCheckInMissionReward := ledgerHasIdempotencyKey(ledger, missionRewardKey(userID, "seasonal_check_in", time.Now().UTC()))
	hasQuarterlyCheckInMissionReward := ledgerHasIdempotencyKey(ledger, missionRewardKey(userID, "quarterly_check_in", time.Now().UTC()))
	hasPredictionOrder := ledgerHasPredictionOrderEvidence(ledger)
	predictionOrderCount := ledgerPredictionOrderEvidenceCount(ledger)
	hasThreePredictionOrders := predictionOrderCount >= 3
	hasFivePredictionOrders := predictionOrderCount >= 5
	hasTenPredictionOrders := predictionOrderCount >= 10
	hasSettlementPayout := ledgerHasSettlementPayoutEvidence(ledger)
	settlementPayoutCount := ledgerSettlementPayoutEvidenceCount(ledger)
	hasThreeSettlementPayouts := settlementPayoutCount >= 3
	hasFiveSettlementPayouts := settlementPayoutCount >= 5
	hasTenSettlementPayouts := settlementPayoutCount >= 10
	hasLeaderboardStanding := leaderboardEvidenceCount(ctx, leaderboardService, userID) > 0
	return []badgeDefinition{
		{
			ID:          "daily_check_in",
			Name:        "Daily check-in badge",
			Description: "Unlocked by claiming your daily Clout at least once.",
			CosmeticID:  "badge-daily-check-in",
			Earned:      hasDailyClaim,
			Source:      "daily_claim",
		},
		{
			ID:          "mission_finisher",
			Name:        "Mission finisher badge",
			Description: "Unlocked by completing a gameplay mission reward.",
			CosmeticID:  "badge-mission-finisher",
			Earned:      hasMissionReward,
			Source:      "mission_reward",
		},
		{
			ID:          "streak_builder",
			Name:        "Streak builder badge",
			Description: "Unlocked by claiming the 3-day check-in streak reward.",
			CosmeticID:  "badge-streak-builder",
			Earned:      hasStreakReward,
			Source:      "streak_reward",
		},
		{
			ID:          "weekly_streak",
			Name:        "Weekly streak badge",
			Description: "Unlocked by claiming the 7-day check-in streak reward.",
			CosmeticID:  "badge-weekly-streak",
			Earned:      hasWeeklyStreakReward,
			Source:      "streak_reward",
		},
		{
			ID:          "streak_champion",
			Name:        "Streak champion badge",
			Description: "Unlocked by claiming the 14-day check-in streak reward.",
			CosmeticID:  "badge-streak-champion",
			Earned:      hasFortnightStreakReward,
			Source:      "streak_reward",
		},
		{
			ID:          "monthly_streak",
			Name:        "Monthly streak badge",
			Description: "Unlocked by claiming the 30-day check-in streak reward.",
			CosmeticID:  "badge-monthly-streak",
			Earned:      hasMonthlyStreakReward,
			Source:      "streak_reward",
		},
		{
			ID:          "double_monthly_streak",
			Name:        "60-day streak badge",
			Description: "Unlocked by claiming the 60-day check-in streak reward.",
			CosmeticID:  "badge-double-monthly-streak",
			Earned:      hasDoubleMonthlyStreakReward,
			Source:      "streak_reward",
		},
		{
			ID:          "quarterly_streak",
			Name:        "90-day streak badge",
			Description: "Unlocked by claiming the 90-day check-in streak reward.",
			CosmeticID:  "badge-quarterly-streak",
			Earned:      hasQuarterlyStreakReward,
			Source:      "streak_reward",
		},
		{
			ID:          "monthly_check_in",
			Name:        "Monthly check-in badge",
			Description: "Unlocked by completing the monthly check-in mission.",
			CosmeticID:  "badge-monthly-check-in",
			Earned:      hasMonthlyCheckInMissionReward,
			Source:      "mission_reward",
		},
		{
			ID:          "seasonal_check_in",
			Name:        "Seasonal check-in badge",
			Description: "Unlocked by completing the seasonal check-in mission.",
			CosmeticID:  "badge-seasonal-check-in",
			Earned:      hasSeasonalCheckInMissionReward,
			Source:      "mission_reward",
		},
		{
			ID:          "quarterly_check_in",
			Name:        "Quarterly check-in badge",
			Description: "Unlocked by completing the quarterly check-in mission.",
			CosmeticID:  "badge-quarterly-check-in",
			Earned:      hasQuarterlyCheckInMissionReward,
			Source:      "mission_reward",
		},
		{
			ID:          "first_prediction",
			Name:        "First prediction badge",
			Description: "Unlocked by placing a prediction order.",
			CosmeticID:  "badge-first-prediction",
			Earned:      hasPredictionOrder,
			Source:      "prediction_order",
		},
		{
			ID:          "prediction_regular",
			Name:        "Prediction regular badge",
			Description: "Unlocked by placing three prediction orders.",
			CosmeticID:  "badge-prediction-regular",
			Earned:      hasThreePredictionOrders,
			Source:      "prediction_order",
		},
		{
			ID:          "prediction_veteran",
			Name:        "Prediction veteran badge",
			Description: "Unlocked by placing five prediction orders.",
			CosmeticID:  "badge-prediction-veteran",
			Earned:      hasFivePredictionOrders,
			Source:      "prediction_order",
		},
		{
			ID:          "prediction_expert",
			Name:        "Prediction expert badge",
			Description: "Unlocked by placing ten prediction orders.",
			CosmeticID:  "badge-prediction-expert",
			Earned:      hasTenPredictionOrders,
			Source:      "prediction_order",
		},
		{
			ID:          "settled_result",
			Name:        "Settled result badge",
			Description: "Unlocked by receiving a prediction settlement result.",
			CosmeticID:  "badge-settled-result",
			Earned:      hasSettlementPayout,
			Source:      "prediction_payout",
		},
		{
			ID:          "settlement_regular",
			Name:        "Settlement regular badge",
			Description: "Unlocked by receiving three prediction settlement results.",
			CosmeticID:  "badge-settlement-regular",
			Earned:      hasThreeSettlementPayouts,
			Source:      "prediction_payout",
		},
		{
			ID:          "settlement_veteran",
			Name:        "Settlement veteran badge",
			Description: "Unlocked by receiving five prediction settlement results.",
			CosmeticID:  "badge-settlement-veteran",
			Earned:      hasFiveSettlementPayouts,
			Source:      "prediction_payout",
		},
		{
			ID:          "settlement_expert",
			Name:        "Settlement expert badge",
			Description: "Unlocked by receiving ten prediction settlement results.",
			CosmeticID:  "badge-settlement-expert",
			Earned:      hasTenSettlementPayouts,
			Source:      "prediction_payout",
		},
		{
			ID:          "leaderboard_debut",
			Name:        "Leaderboard debut badge",
			Description: "Unlocked by appearing on a prediction leaderboard.",
			CosmeticID:  "badge-leaderboard-debut",
			Earned:      hasLeaderboardStanding,
			Source:      "leaderboard_snapshot",
		},
	}
}

func ledgerHasIdempotencyPrefix(entries []wallet.LedgerEntry, prefix string) bool {
	for _, entry := range entries {
		if strings.HasPrefix(entry.IdempotencyKey, prefix) {
			return true
		}
	}
	return false
}

func ledgerHasPredictionOrderEvidence(entries []wallet.LedgerEntry) bool {
	return ledgerPredictionOrderEvidenceCount(entries) > 0
}

func ledgerPredictionOrderEvidenceCount(entries []wallet.LedgerEntry) int {
	seen := make(map[string]struct{})
	for _, entry := range entries {
		key := strings.TrimSpace(entry.IdempotencyKey)
		if strings.HasPrefix(key, "reservation:prediction_order:") ||
			strings.HasPrefix(key, "prediction_fill:") {
			seen[key] = struct{}{}
		}
	}
	return len(seen)
}

func ledgerHasSettlementPayoutEvidence(entries []wallet.LedgerEntry) bool {
	return ledgerSettlementPayoutEvidenceCount(entries) > 0
}

func ledgerSettlementPayoutEvidenceCount(entries []wallet.LedgerEntry) int {
	seen := make(map[string]struct{})
	for _, entry := range entries {
		key := strings.TrimSpace(entry.IdempotencyKey)
		if strings.HasPrefix(key, "prediction_payout:") {
			seen[key] = struct{}{}
		}
	}
	return len(seen)
}

// checkRewardGrantLimitFromLedger evaluates the daily grant limit against an
// already-fetched 500-row ledger window; claim handlers fetch the ledger once
// per request and share it across every pre-credit gate.
func checkRewardGrantLimitFromLedger(entries []wallet.LedgerEntry, idempotencyKey string, amountPoints int64, now time.Time) (rewardGrantLimitStatus, bool) {
	status := rewardLimitStatusFromLedger(entries, now)
	if ledgerHasIdempotencyKey(entries, idempotencyKey) {
		return status, true
	}
	if !status.Enabled || amountPoints <= 0 {
		return status, true
	}
	return status, amountPoints <= status.RemainingPoints
}

func rewardLimitStatus(ctx context.Context, service *wallet.Service, userID string, now time.Time) rewardGrantLimitStatus {
	return rewardLimitStatusFromLedger(service.Ledger(ctx, userID, 500), now)
}

func rewardLimitStatusFromLedger(entries []wallet.LedgerEntry, now time.Time) rewardGrantLimitStatus {
	limit := rewardDailyGrantLimitPoints()
	windowDate := now.UTC().Format("2006-01-02")
	nextReset := time.Date(now.UTC().Year(), now.UTC().Month(), now.UTC().Day()+1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339)
	granted := int64(0)
	for _, entry := range entries {
		if !isRewardGrantReason(entry.Reason) {
			continue
		}
		if ledgerEntryDate(entry.TransactionTime) != windowDate {
			continue
		}
		granted += entry.AmountPoints
	}
	remaining := int64(0)
	if limit > granted {
		remaining = limit - granted
	}
	return rewardGrantLimitStatus{
		Enabled:         limit > 0,
		Unit:            "PTS",
		LimitPoints:     limit,
		GrantedPoints:   granted,
		RemainingPoints: remaining,
		WindowDate:      windowDate,
		NextResetAt:     nextReset,
	}
}

func rewardDailyGrantLimitPoints() int64 {
	raw := strings.TrimSpace(os.Getenv("REWARD_DAILY_GRANT_LIMIT_CENTS"))
	if raw == "" {
		return 0
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n < 0 {
		return 0
	}
	return n
}

// checkRewardAbuseClusters records device/IP cluster signals unless the claim
// is a replay. The replay check reads the caller's already-fetched 500-row
// ledger window instead of re-querying it.
func checkRewardAbuseClusters(r *stdhttp.Request, service *wallet.Service, userID string, entries []wallet.LedgerEntry, idempotencyKey string, now time.Time) error {
	if ledgerHasIdempotencyKey(entries, idempotencyKey) {
		return nil
	}
	date := now.UTC().Format("2006-01-02")
	allowed, kind, err := service.TryRecordRewardClusters(r.Context(), date, userID, []wallet.RewardClusterSignal{
		{Kind: "device", Signal: rewardDeviceSignal(r), MaxUsers: rewardDailyMaxUsersPerDevice()},
		{Kind: "ip", Signal: rewardIPSignal(r), MaxUsers: rewardDailyMaxUsersPerIP()},
	})
	if err != nil {
		return httpx.Internal("reward cluster check failed", err)
	}
	if allowed {
		return nil
	}
	if kind == "ip" {
		return httpx.Forbidden("daily reward IP cluster limit reached")
	}
	return httpx.Forbidden("daily reward device cluster limit reached")
}

func rewardDeviceSignal(r *stdhttp.Request) string {
	return strings.TrimSpace(r.Header.Get(rewardDeviceHeader()))
}

func rewardDeviceHeader() string {
	if h := strings.TrimSpace(os.Getenv("REWARD_DEVICE_HEADER")); h != "" {
		return h
	}
	return "X-TapTrade-Device-ID"
}

func rewardIPSignal(r *stdhttp.Request) string {
	for _, header := range []string{"CF-Connecting-IP", "X-Real-IP", "X-Forwarded-For"} {
		raw := strings.TrimSpace(r.Header.Get(header))
		if raw == "" {
			continue
		}
		if header == "X-Forwarded-For" {
			raw = strings.TrimSpace(strings.Split(raw, ",")[0])
		}
		if ip := net.ParseIP(raw); ip != nil {
			return ip.String()
		}
	}
	host := strings.TrimSpace(r.RemoteAddr)
	if parsedHost, _, err := net.SplitHostPort(host); err == nil {
		host = parsedHost
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip.String()
	}
	return ""
}

func rewardDailyMaxUsersPerDevice() int {
	return envNonNegativeInt("REWARD_DAILY_MAX_USERS_PER_DEVICE")
}

func rewardDailyMaxUsersPerIP() int {
	return envNonNegativeInt("REWARD_DAILY_MAX_USERS_PER_IP")
}

func envNonNegativeInt(key string) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return 0
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 {
		return 0
	}
	return n
}

func isRewardGrantReason(reason string) bool {
	switch strings.TrimSpace(reason) {
	case "daily_claim", "point_pack_grant", "mission_reward", "streak_reward":
		return true
	default:
		return false
	}
}

func ledgerEntryDate(transactionTime string) string {
	if len(transactionTime) < len("2006-01-02") {
		return ""
	}
	date := transactionTime[:len("2006-01-02")]
	if _, err := time.Parse("2006-01-02", date); err != nil {
		return ""
	}
	return date
}

func decodeWalletMutationRequest(r *stdhttp.Request) (walletMutationRequest, error) {
	var fields map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&fields); err != nil {
		return walletMutationRequest{}, httpx.BadRequest("invalid JSON payload", map[string]any{"field": "body"})
	}
	// Launch boundary: retired money-era keys rejected outright (banned
	// literals, not live fields).
	if _, ok := fields["amountCents"]; ok {
		return walletMutationRequest{}, httpx.BadRequest("admin wallet mutations require amountPoints", map[string]any{"field": "amountPoints"})
	}
	if _, ok := fields["amount_cents"]; ok {
		return walletMutationRequest{}, httpx.BadRequest("admin wallet mutations require amountPoints", map[string]any{"field": "amountPoints"})
	}
	raw, err := json.Marshal(fields)
	if err != nil {
		return walletMutationRequest{}, httpx.BadRequest("invalid JSON payload", map[string]any{"field": "body"})
	}
	var request walletMutationRequest
	if err := json.Unmarshal(raw, &request); err != nil {
		return walletMutationRequest{}, httpx.BadRequest("invalid JSON payload", map[string]any{"field": "body"})
	}
	if request.UserID == "" {
		return walletMutationRequest{}, httpx.BadRequest("userId is required", map[string]any{"field": "userId"})
	}
	if request.AmountPoints <= 0 {
		return walletMutationRequest{}, httpx.BadRequest("amountPoints must be greater than zero", map[string]any{"field": "amountPoints"})
	}
	if request.IdempotencyKey == "" {
		return walletMutationRequest{}, httpx.BadRequest("idempotencyKey is required", map[string]any{"field": "idempotencyKey"})
	}
	request.Reason = strings.TrimSpace(request.Reason)
	if err := validateLaunchFacingReason("reason", request.Reason); err != nil {
		return walletMutationRequest{}, err
	}
	return request, nil
}

func mapWalletError(err error) error {
	if errors.Is(err, wallet.ErrInvalidMutationRequest) {
		return httpx.BadRequest("invalid point account mutation request", nil)
	}
	if errors.Is(err, wallet.ErrIdempotencyConflict) {
		return httpx.Conflict("idempotency key conflict for this mutation request", nil)
	}
	if errors.Is(err, wallet.ErrInsufficientFunds) {
		return httpx.Forbidden("insufficient points")
	}
	return httpx.Internal("point account mutation failed", err)
}
