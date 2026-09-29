package http

import (
	"encoding/json"
	"errors"
	"io"
	stdhttp "net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"taptrade/gateway/internal/loyalty"
	canonicalv1 "taptrade/platform/canonical/v1"
	"taptrade/platform/transport/httpx"
)

type loyaltyAdjustmentRequest struct {
	PlayerID       string `json:"playerId"`
	PointsDelta    int64  `json:"pointsDelta"`
	IdempotencyKey string `json:"idempotencyKey"`
	Reason         string `json:"reason"`
	CreatedBy      string `json:"createdBy,omitempty"`
	EntrySubtype   string `json:"entrySubtype,omitempty"`
}

type loyaltyReferralRequest struct {
	ReferrerPlayerID string `json:"referrerPlayerId"`
	ReferredPlayerID string `json:"referredPlayerId"`
}

type loyaltyTierRequest struct {
	DisplayName         string            `json:"displayName"`
	Rank                int               `json:"rank"`
	MinLifetimePoints   int64             `json:"minLifetimePoints"`
	MinRolling30DPoints int64             `json:"minRolling30dPoints"`
	Benefits            map[string]string `json:"benefits"`
	Active              bool              `json:"active"`
}

type loyaltyRuleRequest struct {
	Name                    string   `json:"name"`
	SourceType              string   `json:"sourceType"`
	PredictionSourceType    string   `json:"predictionSourceType"`
	Active                  bool     `json:"active"`
	Multiplier              float64  `json:"multiplier"`
	MinQualifiedStakePoints int64    `json:"minQualifiedStakePoints"`
	MinQualifiedPoints      int64    `json:"minQualifiedPoints"`
	EligibleBetTypes        []string `json:"eligibleBetTypes"`
	EligiblePredictionTypes []string `json:"eligiblePredictionTypes"`
	MaxPointsPerEvent       int64    `json:"maxPointsPerEvent"`
	EffectiveFrom           string   `json:"effectiveFrom"`
	EffectiveTo             string   `json:"effectiveTo"`
}

type loyaltyAccrualRulePayload struct {
	PredictionSourceType    string     `json:"predictionSourceType"`
	RuleID                  string     `json:"ruleId"`
	Name                    string     `json:"name"`
	Active                  bool       `json:"active"`
	Multiplier              float64    `json:"multiplier"`
	MinQualifiedPoints      int64      `json:"minQualifiedPoints"`
	EligiblePredictionTypes []string   `json:"eligiblePredictionTypes"`
	MaxPointsPerEvent       int64      `json:"maxPointsPerEvent,omitempty"`
	EffectiveFrom           *time.Time `json:"effectiveFrom,omitempty"`
	EffectiveTo             *time.Time `json:"effectiveTo,omitempty"`
	Unit                    string     `json:"unit"`
}

type loyaltyLedgerEntryPayload struct {
	EntryID              string            `json:"entryId"`
	AccountID            string            `json:"accountId"`
	PlayerID             string            `json:"playerId"`
	EntryType            string            `json:"entryType"`
	EntrySubtype         string            `json:"entrySubtype,omitempty"`
	PredictionSourceType string            `json:"predictionSourceType"`
	PredictionSourceID   string            `json:"predictionSourceId,omitempty"`
	PointsDelta          int64             `json:"pointsDelta"`
	BalanceAfter         int64             `json:"balanceAfter"`
	Metadata             map[string]string `json:"metadata,omitempty"`
	CreatedBy            string            `json:"createdBy,omitempty"`
	CreatedAt            time.Time         `json:"createdAt"`
	Unit                 string            `json:"unit"`
}

func registerLoyaltyRoutes(mux *stdhttp.ServeMux, service *loyalty.Service) {
	if service == nil {
		return
	}

	listPath := "/api/v1/loyalty"
	mux.Handle(listPath, httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.URL.Path != listPath {
			return httpx.NotFound("loyalty account not found")
		}
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}

		playerID := strings.TrimSpace(r.URL.Query().Get("userId"))
		if playerID == "" {
			playerID = strings.TrimSpace(r.URL.Query().Get("playerId"))
		}
		if playerID == "" {
			return httpx.BadRequest("userId is required", map[string]any{"field": "userId"})
		}
		if err := requireSelfOrAdmin(r, playerID); err != nil {
			return err
		}

		account, ok := service.GetAccount(playerID)
		if !ok {
			return httpx.NotFound("loyalty account not found")
		}

		return httpx.WriteJSON(w, stdhttp.StatusOK, toLoyaltyStandingResponse(account))
	}))

	mux.Handle("/api/v1/loyalty/ledger", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}

		playerID := strings.TrimSpace(r.URL.Query().Get("userId"))
		if playerID == "" {
			playerID = strings.TrimSpace(r.URL.Query().Get("playerId"))
		}
		if playerID == "" {
			return httpx.BadRequest("userId is required", map[string]any{"field": "userId"})
		}
		if err := requireSelfOrAdmin(r, playerID); err != nil {
			return err
		}

		limit := 50
		if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
			parsed, err := strconv.Atoi(raw)
			if err != nil || parsed <= 0 {
				return httpx.BadRequest("limit must be a positive integer", map[string]any{"field": "limit", "value": raw})
			}
			limit = parsed
		}

		if _, ok := service.GetAccount(playerID); !ok {
			return httpx.NotFound("loyalty account not found")
		}

		items := service.Ledger(playerID, limit)
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
			"playerId": playerID,
			"items":    loyaltyLedgerEntryPayloads(items),
			"total":    len(items),
		})
	}))

	mux.Handle("/api/v1/loyalty/tiers", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}

		items := loyaltyTierPayloads(service.ListTiers())
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
			"items":      items,
			"totalCount": len(items),
		})
	}))

	mux.Handle("/api/v1/referrals", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}

		playerID := strings.TrimSpace(r.URL.Query().Get("userId"))
		if playerID == "" {
			playerID = strings.TrimSpace(r.URL.Query().Get("playerId"))
		}
		if playerID == "" {
			return httpx.BadRequest("userId is required", map[string]any{"field": "userId"})
		}
		if err := requireSelfOrAdmin(r, playerID); err != nil {
			return err
		}

		items := service.ListReferralsByReferrer(playerID)
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
			"playerId": playerID,
			"items":    items,
			"total":    len(items),
		})
	}))

	adminListPath := "/api/v1/admin/loyalty/accounts"
	mux.Handle(adminListPath, httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		if err := requireAdminRole(r); err != nil {
			return err
		}

		accounts := service.ListAccounts(loyalty.AccountFilter{
			PlayerID: strings.TrimSpace(r.URL.Query().Get("playerId")),
			TierCode: strings.TrimSpace(r.URL.Query().Get("tierCode")),
			Search:   strings.TrimSpace(r.URL.Query().Get("search")),
		})
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
			"items":      loyaltyAccountPayloads(accounts),
			"totalCount": len(accounts),
		})
	}))

	adminDetailPrefix := "/api/v1/admin/loyalty/accounts/"
	mux.Handle(adminDetailPrefix, httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		if err := requireAdminRole(r); err != nil {
			return err
		}

		playerID := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, adminDetailPrefix))
		if playerID == "" {
			return httpx.NotFound("loyalty account not found")
		}
		account, ok := service.GetAccount(playerID)
		if !ok {
			return httpx.NotFound("loyalty account not found")
		}

		limit := 20
		if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
			parsed, err := strconv.Atoi(raw)
			if err != nil || parsed <= 0 {
				return httpx.BadRequest("limit must be a positive integer", map[string]any{"field": "limit", "value": raw})
			}
			limit = parsed
		}

		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
			"account": toLoyaltyAccountResponse(account),
			"ledger":  loyaltyLedgerEntryPayloads(service.Ledger(playerID, limit)),
			"tiers":   service.ListTiers(),
		})
	}))

	mux.Handle("/api/v1/admin/loyalty/adjustments", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}
		if err := requireAdminRole(r); err != nil {
			return err
		}

		var request loyaltyAdjustmentRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			return httpx.BadRequest("invalid JSON payload", map[string]any{"field": "body"})
		}
		reason := strings.TrimSpace(request.Reason)
		if err := validateLaunchFacingReason("reason", reason); err != nil {
			return err
		}

		entry, account, err := service.Adjust(loyalty.AdjustmentRequest{
			PlayerID:       strings.TrimSpace(request.PlayerID),
			PointsDelta:    request.PointsDelta,
			IdempotencyKey: strings.TrimSpace(request.IdempotencyKey),
			Reason:         reason,
			CreatedBy:      strings.TrimSpace(request.CreatedBy),
			EntrySubtype:   strings.TrimSpace(request.EntrySubtype),
		})
		if err != nil {
			return mapLoyaltyError(err)
		}

		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
			"entry":   toLoyaltyLedgerEntryResponse(entry),
			"account": toLoyaltyAccountResponse(account),
		})
	}))

	mux.Handle("/api/v1/admin/loyalty/referrals", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}
		if err := requireAdminRole(r); err != nil {
			return err
		}

		var request loyaltyReferralRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			return httpx.BadRequest("invalid JSON payload", map[string]any{"field": "body"})
		}

		referral, err := service.RegisterReferral(loyalty.ReferralCreateRequest{
			ReferrerPlayerID: strings.TrimSpace(request.ReferrerPlayerID),
			ReferredPlayerID: strings.TrimSpace(request.ReferredPlayerID),
		})
		if err != nil {
			return mapLoyaltyError(err)
		}

		return httpx.WriteJSON(w, stdhttp.StatusOK, referral)
	}))

	mux.Handle("/api/v1/admin/loyalty/config", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		if err := requireAdminRole(r); err != nil {
			return err
		}

		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
			"tiers":               service.ListTiers(),
			"rules":               loyaltyAccrualRulePayloads(service.ListRules()),
			"referralBonusPoints": service.ReferralBonusPoints(),
		})
	}))

	tierPrefix := "/api/v1/admin/loyalty/tiers/"
	mux.Handle(tierPrefix, httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodPut {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPut)
		}
		if err := requireAdminRole(r); err != nil {
			return err
		}

		tierCode := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, tierPrefix))
		if tierCode == "" {
			return httpx.NotFound("loyalty tier not found")
		}

		var request loyaltyTierRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			return httpx.BadRequest("invalid JSON payload", map[string]any{"field": "body"})
		}
		if err := validateLoyaltyTierLaunchCopy(request); err != nil {
			return err
		}

		items, err := service.UpdateTier(loyalty.TierUpdateRequest{
			TierCode:            canonicalv1.LoyaltyTierCode(tierCode),
			DisplayName:         strings.TrimSpace(request.DisplayName),
			Rank:                request.Rank,
			MinLifetimePoints:   request.MinLifetimePoints,
			MinRolling30DPoints: request.MinRolling30DPoints,
			Benefits:            request.Benefits,
			Active:              request.Active,
		})
		if err != nil {
			return mapLoyaltyError(err)
		}

		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
			"tiers": items,
		})
	}))

	rulesPath := "/api/v1/admin/loyalty/rules"
	mux.Handle(rulesPath, httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.URL.Path != rulesPath {
			return httpx.NotFound("loyalty rule not found")
		}
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}
		if err := requireAdminRole(r); err != nil {
			return err
		}

		request, err := decodeLoyaltyRuleRequest(r.Body)
		if err != nil {
			return err
		}
		if err := validateLoyaltyRuleLaunchCopy(request); err != nil {
			return err
		}

		items, err := service.CreateRule(loyalty.RuleCreateRequest{
			Name:                    strings.TrimSpace(request.Name),
			SourceType:              loyaltyRuleSourceType(request),
			Active:                  request.Active,
			Multiplier:              request.Multiplier,
			MinQualifiedStakePoints: loyaltyRuleMinQualifiedPoints(request),
			EligibleBetTypes:        loyaltyRuleEligiblePredictionTypes(request),
			MaxPointsPerEvent:       request.MaxPointsPerEvent,
			EffectiveFrom:           parseOptionalRFC3339(request.EffectiveFrom),
			EffectiveTo:             parseOptionalRFC3339(request.EffectiveTo),
		})
		if err != nil {
			return mapLoyaltyError(err)
		}

		return httpx.WriteJSON(w, stdhttp.StatusCreated, map[string]any{
			"rules": loyaltyAccrualRulePayloads(items),
		})
	}))

	rulePrefix := "/api/v1/admin/loyalty/rules/"
	mux.Handle(rulePrefix, httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodPut {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPut)
		}
		if err := requireAdminRole(r); err != nil {
			return err
		}

		ruleID := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, rulePrefix))
		if ruleID == "" {
			return httpx.NotFound("loyalty rule not found")
		}

		request, err := decodeLoyaltyRuleRequest(r.Body)
		if err != nil {
			return err
		}
		if err := validateLoyaltyRuleLaunchCopy(request); err != nil {
			return err
		}

		items, err := service.UpdateRule(loyalty.RuleUpdateRequest{
			RuleID:                  ruleID,
			Name:                    strings.TrimSpace(request.Name),
			SourceType:              loyaltyRuleSourceType(request),
			Active:                  request.Active,
			Multiplier:              request.Multiplier,
			MinQualifiedStakePoints: loyaltyRuleMinQualifiedPoints(request),
			EligibleBetTypes:        loyaltyRuleEligiblePredictionTypes(request),
			MaxPointsPerEvent:       request.MaxPointsPerEvent,
			EffectiveFrom:           parseOptionalRFC3339(request.EffectiveFrom),
			EffectiveTo:             parseOptionalRFC3339(request.EffectiveTo),
		})
		if err != nil {
			return mapLoyaltyError(err)
		}

		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
			"rules": loyaltyAccrualRulePayloads(items),
		})
	}))
}

func loyaltyRuleSourceType(request loyaltyRuleRequest) string {
	return toLegacyLoyaltySourceType(strings.TrimSpace(request.PredictionSourceType))
}

func loyaltyRuleMinQualifiedPoints(request loyaltyRuleRequest) int64 {
	return request.MinQualifiedPoints
}

func loyaltyRuleEligiblePredictionTypes(request loyaltyRuleRequest) []string {
	return append([]string(nil), request.EligiblePredictionTypes...)
}

func validateLoyaltyRuleLaunchCopy(request loyaltyRuleRequest) error {
	return validateLaunchFacingReason("name", strings.TrimSpace(request.Name))
}

func decodeLoyaltyRuleRequest(body io.Reader) (loyaltyRuleRequest, error) {
	data, err := io.ReadAll(body)
	if err != nil {
		return loyaltyRuleRequest{}, httpx.BadRequest("invalid JSON payload", map[string]any{"field": "body"})
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return loyaltyRuleRequest{}, httpx.BadRequest("invalid JSON payload", map[string]any{"field": "body"})
	}
	retiredFields := map[string]string{
		"sourceType":              "predictionSourceType",
		"minQualifiedStakePoints": "minQualifiedPoints",
		"eligibleSportIds":        "eligiblePredictionTypes",
		"eligibleBetTypes":        "eligiblePredictionTypes",
	}
	for retired, preferred := range retiredFields {
		if _, ok := raw[retired]; ok {
			return loyaltyRuleRequest{}, httpx.BadRequest("use point-native loyalty rule fields", map[string]any{"field": preferred})
		}
	}
	var request loyaltyRuleRequest
	if err := json.Unmarshal(data, &request); err != nil {
		return loyaltyRuleRequest{}, httpx.BadRequest("invalid JSON payload", map[string]any{"field": "body"})
	}
	return request, nil
}

func loyaltyAccrualRulePayloads(rules []canonicalv1.LoyaltyAccrualRule) []loyaltyAccrualRulePayload {
	out := make([]loyaltyAccrualRulePayload, 0, len(rules))
	for _, rule := range rules {
		out = append(out, toLoyaltyAccrualRulePayload(rule))
	}
	return out
}

func toLoyaltyAccrualRulePayload(rule canonicalv1.LoyaltyAccrualRule) loyaltyAccrualRulePayload {
	return loyaltyAccrualRulePayload{
		PredictionSourceType:    toLaunchLoyaltySourceType(rule.SourceType),
		RuleID:                  rule.RuleID,
		Name:                    rule.Name,
		Active:                  rule.Active,
		Multiplier:              rule.Multiplier,
		MinQualifiedPoints:      rule.MinQualifiedStakePoints,
		EligiblePredictionTypes: append([]string(nil), rule.EligibleBetTypes...),
		MaxPointsPerEvent:       rule.MaxPointsPerEvent,
		EffectiveFrom:           rule.EffectiveFrom,
		EffectiveTo:             rule.EffectiveTo,
		Unit:                    "PTS",
	}
}

func loyaltyLedgerEntryPayloads(entries []canonicalv1.LoyaltyLedgerEntry) []loyaltyLedgerEntryPayload {
	out := make([]loyaltyLedgerEntryPayload, 0, len(entries))
	for _, entry := range entries {
		out = append(out, toLoyaltyLedgerEntryResponse(entry))
	}
	return out
}

func toLaunchLoyaltySourceType(sourceType string) string {
	if strings.TrimSpace(sourceType) == string(canonicalv1.LoyaltyLedgerSourceBetSettlement) {
		return "prediction_settlement"
	}
	return strings.TrimSpace(sourceType)
}

func toLegacyLoyaltySourceType(sourceType string) string {
	if strings.TrimSpace(sourceType) == "prediction_settlement" {
		return string(canonicalv1.LoyaltyLedgerSourceBetSettlement)
	}
	return strings.TrimSpace(sourceType)
}

func loyaltyAccountPayloads(accounts []canonicalv1.LoyaltyAccount) []map[string]any {
	out := make([]map[string]any, 0, len(accounts))
	for _, account := range accounts {
		out = append(out, toLoyaltyAccountResponse(account))
	}
	return out
}

func toLoyaltyAccountResponse(account canonicalv1.LoyaltyAccount) map[string]any {
	out := account
	if account.CurrentTierAssignedAt != nil {
		t := account.CurrentTierAssignedAt.UTC().Truncate(time.Second)
		out.CurrentTierAssignedAt = &t
	}
	if account.LastAccrualAt != nil {
		t := account.LastAccrualAt.UTC().Truncate(time.Second)
		out.LastAccrualAt = &t
	}
	out.CreatedAt = account.CreatedAt.UTC().Truncate(time.Second)
	out.UpdatedAt = account.UpdatedAt.UTC().Truncate(time.Second)
	rank, rankName := canonicalLoyaltyRank(out.CurrentTier)
	nextRank, nextRankName := canonicalLoyaltyRank(out.NextTier)
	payload := map[string]any{
		"accountId":                out.AccountID,
		"playerId":                 out.PlayerID,
		"pointsBalance":            out.PointsBalance,
		"pointsEarnedLifetime":     out.PointsEarnedLifetime,
		"pointsEarned7D":           out.PointsEarned7D,
		"pointsEarned30D":          out.PointsEarned30D,
		"pointsEarnedCurrentMonth": out.PointsEarnedCurrentMonth,
		"rank":                     rank,
		"rankName":                 rankName,
		"nextRank":                 nextRank,
		"nextRankName":             nextRankName,
		"xpToNextRank":             out.PointsToNextTier,
		"unit":                     "PTS",
		"createdAt":                out.CreatedAt,
		"updatedAt":                out.UpdatedAt,
	}
	if out.CurrentTierAssignedAt != nil {
		payload["rankAssignedAt"] = out.CurrentTierAssignedAt
	}
	if out.LastAccrualAt != nil {
		payload["lastAccrualAt"] = out.LastAccrualAt
	}
	return payload
}

func toLoyaltyStandingResponse(account canonicalv1.LoyaltyAccount) map[string]any {
	out := account
	if account.LastAccrualAt != nil {
		t := account.LastAccrualAt.UTC().Truncate(time.Second)
		out.LastAccrualAt = &t
	}
	rank, rankName := canonicalLoyaltyRank(out.CurrentTier)
	nextRank, nextRankName := canonicalLoyaltyRank(out.NextTier)
	payload := map[string]any{
		"userId":        out.PlayerID,
		"pointsBalance": out.PointsBalance,
		"xp":            out.PointsEarnedLifetime,
		"xpPoints":      out.PointsEarnedLifetime,
		"rank":          rank,
		"rankName":      rankName,
		"nextRank":      nextRank,
		"nextRankName":  nextRankName,
		"xpToNextRank":  out.PointsToNextTier,
		"unit":          "PTS",
	}
	if out.LastAccrualAt != nil {
		payload["lastActivity"] = out.LastAccrualAt
	}
	return payload
}

func loyaltyTierPayloads(tiers []canonicalv1.LoyaltyTier) []map[string]any {
	out := make([]map[string]any, 0, len(tiers))
	for _, tier := range tiers {
		out = append(out, toLoyaltyTierResponse(tier))
	}
	return out
}

func toLoyaltyTierResponse(tier canonicalv1.LoyaltyTier) map[string]any {
	rank := tier.Rank
	rankName := tier.DisplayName
	if rank == 0 || strings.TrimSpace(rankName) == "" {
		fallbackRank, fallbackName := canonicalLoyaltyRank(tier.TierCode)
		if rank == 0 {
			rank = fallbackRank
		}
		if strings.TrimSpace(rankName) == "" {
			rankName = fallbackName
		}
	}
	return map[string]any{
		"rank":        rank,
		"rankName":    redactLaunchProhibitedUserText(rankName),
		"minXpPoints": tier.MinLifetimePoints,
		"unit":        "PTS",
		"benefits":    loyaltyTierBenefits(tier.Benefits),
	}
}

func validateLoyaltyTierLaunchCopy(request loyaltyTierRequest) error {
	if err := validateLaunchFacingReason("displayName", strings.TrimSpace(request.DisplayName)); err != nil {
		return err
	}
	for _, benefit := range request.Benefits {
		if err := validateLaunchFacingReason("benefits", strings.TrimSpace(benefit)); err != nil {
			return err
		}
	}
	return nil
}

func loyaltyTierBenefits(benefits map[string]string) []string {
	if len(benefits) == 0 {
		return nil
	}
	keys := make([]string, 0, len(benefits))
	for key := range benefits {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	out := make([]string, 0, len(keys))
	for _, key := range keys {
		if benefit := strings.TrimSpace(benefits[key]); benefit != "" {
			out = append(out, redactLaunchProhibitedUserText(benefit))
		}
	}
	return out
}

func canonicalLoyaltyRank(code canonicalv1.LoyaltyTierCode) (int, string) {
	switch code {
	case canonicalv1.LoyaltyTierVIP:
		return 4, "VIP"
	case canonicalv1.LoyaltyTierGold:
		return 3, "Gold"
	case canonicalv1.LoyaltyTierSilver:
		return 2, "Silver"
	case canonicalv1.LoyaltyTierBronze:
		return 1, "Bronze"
	default:
		return 0, ""
	}
}

func toLoyaltyLedgerEntryResponse(entry canonicalv1.LoyaltyLedgerEntry) loyaltyLedgerEntryPayload {
	return loyaltyLedgerEntryPayload{
		EntryID:              entry.EntryID,
		AccountID:            entry.AccountID,
		PlayerID:             entry.PlayerID,
		EntryType:            string(entry.EntryType),
		EntrySubtype:         entry.EntrySubtype,
		PredictionSourceType: toLaunchLoyaltySourceType(string(entry.SourceType)),
		PredictionSourceID:   toLaunchLoyaltySourceID(entry.SourceID),
		PointsDelta:          entry.PointsDelta,
		BalanceAfter:         entry.BalanceAfter,
		Metadata:             loyaltyLedgerMetadataPayload(entry),
		CreatedBy:            entry.CreatedBy,
		CreatedAt:            entry.CreatedAt.UTC().Truncate(time.Second),
		Unit:                 "PTS",
	}
}

func loyaltyLedgerMetadataPayload(entry canonicalv1.LoyaltyLedgerEntry) map[string]string {
	metadata := map[string]string{}
	for key, value := range entry.Metadata {
		switch strings.TrimSpace(key) {
		case "betId":
			metadata["predictionId"] = toLaunchLoyaltySourceID(value)
		case "stakePoints":
			metadata["pointVolumePoints"] = value
		case "reason":
			metadata["reason"] = toLaunchLoyaltyReason(value)
		default:
			metadata[key] = toLaunchLoyaltyReason(value)
		}
	}
	if strings.TrimSpace(entry.SourceID) != "" {
		if _, ok := metadata["predictionId"]; !ok && entry.SourceType == canonicalv1.LoyaltyLedgerSourceBetSettlement {
			metadata["predictionId"] = toLaunchLoyaltySourceID(entry.SourceID)
		}
	}
	if len(metadata) == 0 {
		return nil
	}
	return metadata
}

func toLaunchLoyaltySourceID(sourceID string) string {
	sourceID = strings.TrimSpace(sourceID)
	if strings.HasPrefix(sourceID, "bet:") {
		return "prediction:" + strings.TrimPrefix(sourceID, "bet:")
	}
	return sourceID
}

func toLaunchLoyaltyReason(reason string) string {
	reason = strings.TrimSpace(reason)
	reason = strings.ReplaceAll(reason, "settled bet", "prediction settlement")
	reason = strings.ReplaceAll(reason, "Settled bet", "Prediction settlement")
	reason = strings.ReplaceAll(reason, "qualified bet", "qualified prediction")
	reason = strings.ReplaceAll(reason, "Qualified bet", "Qualified prediction")
	return redactLaunchProhibitedUserText(reason)
}

func mapLoyaltyError(err error) error {
	switch {
	case errors.Is(err, loyalty.ErrInvalidRequest):
		return httpx.BadRequest("invalid loyalty request", nil)
	case errors.Is(err, loyalty.ErrAccountNotFound):
		return httpx.NotFound("loyalty account not found")
	case errors.Is(err, loyalty.ErrTierNotFound):
		return httpx.NotFound("loyalty tier not found")
	case errors.Is(err, loyalty.ErrRuleNotFound):
		return httpx.NotFound("loyalty rule not found")
	case errors.Is(err, loyalty.ErrAdjustmentConflict), errors.Is(err, loyalty.ErrAccrualConflict):
		return httpx.Conflict("loyalty idempotency conflict", nil)
	case errors.Is(err, loyalty.ErrReferralConflict):
		return httpx.Conflict("referral already belongs to a different referrer", nil)
	default:
		return httpx.Internal("loyalty operation failed", err)
	}
}
