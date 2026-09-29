package http

import (
	"context"
	"encoding/json"
	"fmt"
	stdhttp "net/http"
	"strconv"
	"strings"

	"taptrade/gateway/internal/bonus"
	"taptrade/platform/transport/httpx"
)

func registerBonusRoutes(mux *stdhttp.ServeMux, svc *bonus.Service) {
	// Player-facing
	mux.Handle("/api/v1/bonuses/active", httpx.Handle(playerActiveBonusesHandler(svc)))
	mux.Handle("/api/v1/bonuses/claim", httpx.Handle(claimBonusHandler(svc)))
	mux.Handle("/api/v1/bonuses/", httpx.Handle(playerBonusDetailHandler(svc)))

	// Admin
	mux.Handle("/api/v1/admin/campaigns", httpx.Handle(adminCampaignsHandler(svc)))
	mux.Handle("/api/v1/admin/campaigns/", httpx.Handle(adminCampaignDetailHandler(svc)))
	mux.Handle("/api/v1/admin/bonuses", httpx.Handle(adminBonusesListHandler(svc)))
	mux.Handle("/api/v1/admin/bonuses/grant", httpx.Handle(adminGrantBonusHandler(svc)))
	mux.Handle("/api/v1/admin/bonuses/", httpx.Handle(adminBonusDetailHandler(svc)))
}

type activeBonusLister interface {
	ListActiveBonuses(ctx context.Context, userID string) ([]bonus.PlayerBonus, error)
}

type bonusClaimer interface {
	ClaimBonus(ctx context.Context, req bonus.ClaimBonusRequest) (bonus.PlayerBonus, error)
}

type playerBonusGetter interface {
	GetPlayerBonus(ctx context.Context, id int64) (bonus.PlayerBonus, error)
}

type adminBonusGranter interface {
	GrantBonus(ctx context.Context, req bonus.GrantBonusRequest) (bonus.PlayerBonus, error)
}

type adminBonusDetailService interface {
	playerBonusGetter
	ForfeitPlayerBonus(ctx context.Context, bonusID int64, req bonus.ForfeitBonusRequest) error
}

func pointAliasBadRequest(err error) *httpx.AppError {
	if fieldErr, ok := err.(interface{ FieldName() string }); ok {
		return httpx.BadRequest(redactLaunchProhibitedUserText(err.Error()), map[string]any{"field": fieldErr.FieldName()})
	}
	message := err.Error()
	if before, _, ok := strings.Cut(message, " conflicts with "); ok && strings.Contains(before, "_points") {
		field := before
		if idx := strings.LastIndex(field, ": "); idx >= 0 {
			field = field[idx+2:]
		}
		return httpx.BadRequest(redactLaunchProhibitedUserText(message), map[string]any{"field": field})
	}
	return httpx.BadRequest(redactLaunchProhibitedUserText(message), nil)
}

func campaignActionResponse(status string) map[string]string {
	return map[string]string{
		"status": status,
		"unit":   "PTS",
	}
}

// --- Player Endpoints ---

func playerActiveBonusesHandler(svc activeBonusLister) func(stdhttp.ResponseWriter, *stdhttp.Request) error {
	return func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		userID := httpx.UserIDFromContext(r.Context())
		if userID == "" {
			return httpx.Unauthorized("authentication required")
		}

		bonuses, err := svc.ListActiveBonuses(r.Context(), userID)
		if err != nil {
			return httpx.Internal("failed to list bonuses", err)
		}

		items := make([]map[string]any, 0, len(bonuses))
		for _, b := range bonuses {
			name := ""
			if b.Metadata != nil {
				var meta map[string]any
				if err := json.Unmarshal(b.Metadata, &meta); err == nil {
					if n, ok := meta["campaign_name"].(string); ok {
						name = n
					}
				}
			}
			items = append(items, playerBonusResponse(b, name))
		}

		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{"bonuses": items})
	}
}

func claimBonusHandler(svc bonusClaimer) func(stdhttp.ResponseWriter, *stdhttp.Request) error {
	return func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}
		userID := httpx.UserIDFromContext(r.Context())
		if userID == "" {
			return httpx.Unauthorized("authentication required")
		}

		var req bonus.ClaimBonusRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return httpx.BadRequest("invalid request body", nil)
		}
		req.UserID = userID

		pb, err := svc.ClaimBonus(r.Context(), req)
		if err != nil {
			errMsg := err.Error()
			redactedErrMsg := redactLaunchProhibitedUserText(errMsg)
			if strings.Contains(errMsg, "already claimed") {
				return httpx.WriteJSON(w, stdhttp.StatusConflict, map[string]string{"error": redactedErrMsg})
			}
			if strings.Contains(errMsg, "not active") || strings.Contains(errMsg, "not eligible") ||
				strings.Contains(errMsg, "requires verified point activity") ||
				strings.Contains(errMsg, "not within") || strings.Contains(errMsg, "maximum claims") {
				return httpx.WriteJSON(w, stdhttp.StatusForbidden, map[string]string{"error": redactedErrMsg})
			}
			return httpx.Internal("internal error", err)
		}

		return httpx.WriteJSON(w, stdhttp.StatusCreated, playerBonusResponse(pb, campaignNameFromBonus(pb)))
	}
}

func playerBonusDetailHandler(svc playerBonusGetter) func(stdhttp.ResponseWriter, *stdhttp.Request) error {
	return func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}

		// Parse /api/v1/bonuses/{id}
		path := strings.TrimPrefix(r.URL.Path, "/api/v1/bonuses/")
		parts := strings.SplitN(path, "/", 2)
		id, err := strconv.ParseInt(parts[0], 10, 64)
		if err != nil {
			return httpx.BadRequest("invalid bonus id", nil)
		}

		pb, err := svc.GetPlayerBonus(r.Context(), id)
		if err != nil {
			return httpx.NotFound(fmt.Sprintf("bonus %d not found", id))
		}

		// Verify the requesting user owns this bonus
		userID := httpx.UserIDFromContext(r.Context())
		if pb.UserID != userID {
			return httpx.Forbidden("access denied")
		}

		return httpx.WriteJSON(w, stdhttp.StatusOK, playerBonusResponse(pb, campaignNameFromBonus(pb)))
	}
}

func campaignNameFromBonus(pb bonus.PlayerBonus) string {
	if pb.Metadata == nil {
		return ""
	}
	var meta map[string]any
	if err := json.Unmarshal(pb.Metadata, &meta); err != nil {
		return ""
	}
	name, _ := meta["campaign_name"].(string)
	return name
}

func playerBonusResponse(pb bonus.PlayerBonus, campaignName string) map[string]any {
	expiresAt := pb.ExpiresAt.Format("2006-01-02T15:04:05Z07:00")
	grantedAt := pb.GrantedAt.Format("2006-01-02T15:04:05Z07:00")
	bonusType := launchCampaignType(pb.BonusType)
	safeCampaignName := redactLaunchProhibitedUserText(campaignName)

	return map[string]any{
		"unit": "PTS",

		"bonus_id":      pb.ID,
		"bonusId":       pb.ID,
		"campaign_name": safeCampaignName,
		"campaignName":  safeCampaignName,
		"bonus_type":    bonusType,
		"bonusType":     bonusType,
		"status":        pb.Status,
		"expires_at":    expiresAt,
		"expiresAt":     expiresAt,
		"granted_at":    grantedAt,
		"grantedAt":     grantedAt,

		"grantedPoints":   pb.GrantedAmountPoints,
		"remainingPoints": pb.RemainingAmountPoints,
	}
}

// --- Admin Endpoints ---

func adminCampaignsHandler(svc *bonus.Service) func(stdhttp.ResponseWriter, *stdhttp.Request) error {
	return func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		role := httpx.RoleFromContext(r.Context())
		if role != "admin" {
			return httpx.Forbidden("admin role required")
		}

		switch r.Method {
		case stdhttp.MethodGet:
			status := r.URL.Query().Get("status")
			campaigns, err := svc.ListCampaigns(r.Context(), status, 100)
			if err != nil {
				return httpx.Internal("internal error", err)
			}
			items := make([]map[string]any, 0, len(campaigns))
			for _, c := range campaigns {
				items = append(items, campaignResponse(c))
			}
			return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{"campaigns": items})

		case stdhttp.MethodPost:
			req, err := decodeAdminCampaignCreateRequest(r)
			if err != nil {
				return err
			}
			req.CreatedBy = httpx.UserIDFromContext(r.Context())

			c, err := svc.CreateCampaign(r.Context(), req)
			if err != nil {
				return pointAliasBadRequest(err)
			}
			return httpx.WriteJSON(w, stdhttp.StatusCreated, campaignResponse(c))

		default:
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet, stdhttp.MethodPost)
		}
	}
}

func adminCampaignDetailHandler(svc *bonus.Service) func(stdhttp.ResponseWriter, *stdhttp.Request) error {
	return func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		role := httpx.RoleFromContext(r.Context())
		if role != "admin" {
			return httpx.Forbidden("admin role required")
		}

		// Parse /api/v1/admin/campaigns/{id}[/action]
		path := strings.TrimPrefix(r.URL.Path, "/api/v1/admin/campaigns/")
		parts := strings.SplitN(path, "/", 2)
		id, err := strconv.ParseInt(parts[0], 10, 64)
		if err != nil {
			return httpx.BadRequest("invalid campaign id", nil)
		}

		// Lifecycle actions
		if len(parts) == 2 && r.Method == stdhttp.MethodPost {
			switch parts[1] {
			case "activate":
				if err := svc.ActivateCampaign(r.Context(), id); err != nil {
					return serviceBadRequestError(err, nil)
				}
				return httpx.WriteJSON(w, stdhttp.StatusOK, campaignActionResponse("active"))
			case "pause":
				if err := svc.PauseCampaign(r.Context(), id); err != nil {
					return serviceBadRequestError(err, nil)
				}
				return httpx.WriteJSON(w, stdhttp.StatusOK, campaignActionResponse("paused"))
			case "close":
				if err := svc.CloseCampaign(r.Context(), id); err != nil {
					return serviceBadRequestError(err, nil)
				}
				return httpx.WriteJSON(w, stdhttp.StatusOK, campaignActionResponse("closed"))
			default:
				return httpx.BadRequest("unknown action: "+parts[1], nil)
			}
		}

		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet, stdhttp.MethodPost)
		}

		c, rules, err := svc.GetCampaignWithRules(r.Context(), id)
		if err != nil {
			return httpx.NotFound(redactLaunchProhibitedUserText(err.Error()))
		}
		ruleItems := make([]map[string]any, 0, len(rules))
		for _, rule := range rules {
			ruleItems = append(ruleItems, campaignRuleResponse(rule))
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{"campaign": campaignResponse(c), "rules": ruleItems})
	}
}

func adminBonusesListHandler(svc *bonus.Service) func(stdhttp.ResponseWriter, *stdhttp.Request) error {
	return func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		role := httpx.RoleFromContext(r.Context())
		if role != "admin" {
			return httpx.Forbidden("admin role required")
		}

		userID := r.URL.Query().Get("user_id")
		status := r.URL.Query().Get("status")
		bonuses, err := svc.ListPlayerBonuses(r.Context(), userID, status, 100)
		if err != nil {
			return httpx.Internal("internal error", err)
		}
		items := make([]map[string]any, 0, len(bonuses))
		for _, pb := range bonuses {
			items = append(items, playerBonusResponse(pb, campaignNameFromBonus(pb)))
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{"bonuses": items})
	}
}

func adminGrantBonusHandler(svc adminBonusGranter) func(stdhttp.ResponseWriter, *stdhttp.Request) error {
	return func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}
		role := httpx.RoleFromContext(r.Context())
		if role != "admin" {
			return httpx.Forbidden("admin role required")
		}

		req, err := decodeAdminBonusGrantRequest(r)
		if err != nil {
			return err
		}
		req.GrantedBy = httpx.UserIDFromContext(r.Context())

		pb, err := svc.GrantBonus(r.Context(), req)
		if err != nil {
			return pointAliasBadRequest(err)
		}
		return httpx.WriteJSON(w, stdhttp.StatusCreated, playerBonusResponse(pb, campaignNameFromBonus(pb)))
	}
}

func decodeAdminCampaignCreateRequest(r *stdhttp.Request) (bonus.CreateCampaignRequest, error) {
	var fields map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&fields); err != nil {
		return bonus.CreateCampaignRequest{}, httpx.BadRequest("invalid request body", nil)
	}
	// Launch boundary: the retired money-era key is rejected outright
	// ("budget_cents" kept as the banned literal, not a live field).
	if _, ok := fields["budget_cents"]; ok {
		return bonus.CreateCampaignRequest{}, httpx.BadRequest("admin campaign budget must use budget_points", map[string]any{"field": "budget_points"})
	}
	if rawType, ok := fields["campaign_type"]; ok {
		var campaignType string
		if err := json.Unmarshal(rawType, &campaignType); err == nil && isRetiredCampaignType(campaignType) {
			return bonus.CreateCampaignRequest{}, httpx.BadRequest("admin campaign type must use point-native type", map[string]any{"field": "campaign_type"})
		}
	}
	if rawRules, ok := fields["rules"]; ok {
		if err := validateAdminCampaignRulesRequest(rawRules); err != nil {
			return bonus.CreateCampaignRequest{}, err
		}
	}
	raw, err := json.Marshal(fields)
	if err != nil {
		return bonus.CreateCampaignRequest{}, httpx.BadRequest("invalid request body", nil)
	}
	var req bonus.CreateCampaignRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		return bonus.CreateCampaignRequest{}, httpx.BadRequest("invalid request body", nil)
	}
	return req, nil
}

func validateAdminCampaignRulesRequest(rawRules json.RawMessage) error {
	var rules []map[string]json.RawMessage
	if err := json.Unmarshal(rawRules, &rules); err != nil {
		return httpx.BadRequest("invalid request body", nil)
	}
	for i, rule := range rules {
		if _, ok := rule["rule_config"]; ok {
			return httpx.BadRequest("admin campaign rules must use point_rule_config", map[string]any{"field": fmt.Sprintf("rules[%d].point_rule_config", i)})
		}
		rawConfig, ok := rule["point_rule_config"]
		if !ok || len(rawConfig) == 0 {
			continue
		}
		var cfg map[string]json.RawMessage
		if err := json.Unmarshal(rawConfig, &cfg); err != nil {
			return httpx.BadRequest("invalid request body", nil)
		}
		for retired, preferred := range map[string]string{
			"max_bonus_cents":              "max_bonus_points",
			"fixed_amount_cents":           "fixed_amount_points",
			"max_stake_contribution_cents": "max_play_contribution_points",
			"min_amount_cents":             "min_amount_points",
		} {
			if _, ok := cfg[retired]; ok {
				return httpx.BadRequest("admin campaign rule config must use point-native amount fields", map[string]any{"field": fmt.Sprintf("rules[%d].point_rule_config.%s", i, preferred)})
			}
		}
		if rawType, ok := cfg["type"]; ok {
			var rewardType string
			if err := json.Unmarshal(rawType, &rewardType); err == nil && isRetiredCampaignType(rewardType) {
				return httpx.BadRequest("admin campaign reward type must use point-native type", map[string]any{"field": fmt.Sprintf("rules[%d].point_rule_config.type", i)})
			}
		}
	}
	return nil
}

func decodeAdminBonusGrantRequest(r *stdhttp.Request) (bonus.GrantBonusRequest, error) {
	var fields map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&fields); err != nil {
		return bonus.GrantBonusRequest{}, httpx.BadRequest("invalid request body", nil)
	}
	if _, ok := fields["override_amount_points"]; ok {
		return bonus.GrantBonusRequest{}, httpx.BadRequest("admin bonus grant override must use override_points", map[string]any{"field": "override_points"})
	}
	raw, err := json.Marshal(fields)
	if err != nil {
		return bonus.GrantBonusRequest{}, httpx.BadRequest("invalid request body", nil)
	}
	var req bonus.GrantBonusRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		return bonus.GrantBonusRequest{}, httpx.BadRequest("invalid request body", nil)
	}
	req.Reason = strings.TrimSpace(req.Reason)
	if err := validateLaunchFacingReason("reason", req.Reason); err != nil {
		return bonus.GrantBonusRequest{}, err
	}
	return req, nil
}

func isRetiredCampaignType(value string) bool {
	switch strings.TrimSpace(value) {
	case "freebet_grant", "freebet", "cash", "odds_boost", "deposit_match":
		return true
	default:
		return false
	}
}

func adminBonusDetailHandler(svc adminBonusDetailService) func(stdhttp.ResponseWriter, *stdhttp.Request) error {
	return func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		role := httpx.RoleFromContext(r.Context())
		if role != "admin" {
			return httpx.Forbidden("admin role required")
		}

		// Parse /api/v1/admin/bonuses/{id}[/forfeit]
		path := strings.TrimPrefix(r.URL.Path, "/api/v1/admin/bonuses/")
		parts := strings.SplitN(path, "/", 2)
		id, err := strconv.ParseInt(parts[0], 10, 64)
		if err != nil {
			return httpx.BadRequest("invalid bonus id", nil)
		}

		if len(parts) == 2 && parts[1] == "forfeit" && r.Method == stdhttp.MethodPost {
			var req bonus.ForfeitBonusRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				return httpx.BadRequest("invalid request body", nil)
			}
			req.Reason = strings.TrimSpace(req.Reason)
			if err := validateLaunchFacingReason("reason", req.Reason); err != nil {
				return err
			}
			req.ForfeitedBy = httpx.UserIDFromContext(r.Context())

			if err := svc.ForfeitPlayerBonus(r.Context(), id, req); err != nil {
				return serviceBadRequestError(err, nil)
			}
			return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]string{
				"status": "forfeited",
				"unit":   "PTS",
			})
		}

		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet, stdhttp.MethodPost)
		}

		pb, err := svc.GetPlayerBonus(r.Context(), id)
		if err != nil {
			return httpx.NotFound(redactLaunchProhibitedUserText(err.Error()))
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, playerBonusResponse(pb, campaignNameFromBonus(pb)))
	}
}

func campaignResponse(c bonus.Campaign) map[string]any {
	payload := map[string]any{
		"unit": "PTS",

		"id":           c.ID,
		"name":         redactLaunchProhibitedUserText(c.Name),
		"description":  redactLaunchProhibitedUserText(c.Description),
		"campaignType": launchCampaignType(c.CampaignType),
		"status":       c.Status,
		"startAt":      c.StartAt,
		"endAt":        c.EndAt,
		"spentPoints":  c.SpentPoints,
		"maxClaims":    c.MaxClaims,
		"claimCount":   c.ClaimCount,
		"createdBy":    c.CreatedBy,
		"createdAt":    c.CreatedAt,
		"updatedAt":    c.UpdatedAt,
	}
	if c.BudgetPoints != nil {
		payload["budgetPoints"] = *c.BudgetPoints
	} else {
		payload["budgetPoints"] = nil
	}
	return payload
}

func launchCampaignType(campaignType string) string {
	switch campaignType {
	case "freebet_grant", "freebet", "cash", "odds_boost":
		return "point_grant"
	case "deposit_match":
		return "point_match"
	default:
		return campaignType
	}
}

func campaignRuleResponse(rule bonus.CampaignRule) map[string]any {
	return map[string]any{
		"unit":            "PTS",
		"id":              rule.ID,
		"campaignId":      rule.CampaignID,
		"ruleType":        launchCampaignRuleType(rule.RuleType),
		"pointRuleConfig": pointRuleConfig(rule.RuleConfig),
		"createdAt":       rule.CreatedAt,
	}
}

func launchCampaignRuleType(ruleType string) string {
	return ruleType
}

func pointRuleConfig(raw json.RawMessage) map[string]any {
	if raw == nil {
		return map[string]any{}
	}
	var cfg map[string]any
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return map[string]any{}
	}

	// Points unit-model (2026-07-07): retired stored-config keys are the
	// cents-era spellings (plus the prohibited "stake" alias); they are
	// filtered here and re-emitted via the point-native aliases below.
	retiredKeys := map[string]bool{
		"max_bonus_cents":               true,
		"fixed_amount_cents":            true,
		"max_stake_contribution_cents":  true,
		"max_stake_contribution_points": true,
		"min_odds_decimal":              true,
		"parlay_multiplier":             true,
		"excluded_sports":               true,
		"min_amount_cents":              true,
		"min_deposits":                  true,
		"tier_min":                      true,
	}
	copyConfig := make(map[string]any, len(cfg)+4)
	for key, value := range cfg {
		if retiredKeys[key] {
			continue
		}
		if key == "type" {
			if typeValue, ok := value.(string); ok {
				copyConfig[key] = launchCampaignType(typeValue)
				continue
			}
		}
		if key == "event" {
			if eventValue, ok := value.(string); ok {
				copyConfig[key] = launchCampaignTriggerEvent(eventValue)
				continue
			}
		}
		copyConfig[key] = value
	}
	copyAlias := func(from, to string) {
		if _, ok := copyConfig[to]; ok {
			return
		}
		if value, ok := cfg[from]; ok {
			copyConfig[to] = value
		}
	}
	copyAlias("max_bonus_cents", "max_bonus_points")
	copyAlias("fixed_amount_cents", "fixed_amount_points")
	copyAlias("max_stake_contribution_cents", "max_play_contribution_points")
	copyAlias("max_stake_contribution_points", "max_play_contribution_points")
	copyAlias("min_amount_cents", "min_points")
	copyAlias("min_deposits", "min_point_activity_count")
	copyAlias("tier_min", "rank_min")
	return copyConfig
}

func launchCampaignTriggerEvent(event string) string {
	switch strings.ToLower(strings.TrimSpace(event)) {
	case "deposit", "cash", "crypto", "fiat", "withdraw", "withdrawal", "redeem", "redeemable":
		return "manual_review"
	case "freebet", "odds_boost":
		return "point_grant"
	case "bet", "wager", "wagering", "stake":
		return "prediction_order"
	default:
		return event
	}
}
