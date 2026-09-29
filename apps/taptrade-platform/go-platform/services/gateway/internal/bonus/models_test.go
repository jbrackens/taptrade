package bonus

import (
	"encoding/json"
	"testing"
)

func TestCreateCampaignRequestNormalizePointAliases(t *testing.T) {
	var req CreateCampaignRequest
	body := []byte(`{
		"name": "Launch Points",
		"campaign_type": "custom",
		"budget_points": 7500,
		"rules": [
			{
				"rule_type": "reward",
				"point_rule_config": {
					"fixed_amount_points": 500,
					"max_bonus_points": 2500,
					"min_points": 100,
					"type": "freebet"
				}
			},
			{
				"rule_type": "eligibility",
				"point_rule_config": {
					"min_point_activity_count": 2,
					"rank_min": "gold"
				}
			}
		]
	}`)
	if err := json.Unmarshal(body, &req); err != nil {
		t.Fatalf("unmarshal request: %v", err)
	}

	req.NormalizePointAliases()

	if req.CampaignType != "custom" {
		t.Fatalf("expected campaign type to stay custom, got %q", req.CampaignType)
	}
	if req.BudgetPoints == nil || *req.BudgetPoints != 7500 {
		t.Fatalf("expected budget alias to normalize, got %+v", req.BudgetPoints)
	}
	var reward map[string]any
	if err := json.Unmarshal(req.Rules[0].RuleConfig, &reward); err != nil {
		t.Fatalf("unmarshal normalized reward config: %v", err)
	}
	if reward["fixed_amount_points"] != float64(500) {
		t.Fatalf("expected fixed amount alias, got %+v", reward)
	}
	if reward["max_bonus_points"] != float64(2500) {
		t.Fatalf("expected max bonus alias, got %+v", reward)
	}
	if reward["min_amount_points"] != float64(100) {
		t.Fatalf("expected minimum point alias, got %+v", reward)
	}
	if reward["type"] != "point_grant" {
		t.Fatalf("expected retired reward type to normalize, got %+v", reward)
	}
	// Points unit-model (2026-07-07): fixed_amount_points / max_bonus_points
	// ARE the canonical keys now; only genuinely retired spellings must be
	// rewritten away before persistence.
	for _, retiredInput := range []string{"min_points"} {
		if _, ok := reward[retiredInput]; ok {
			t.Fatalf("retired key %q should be normalized before persistence: %+v", retiredInput, reward)
		}
	}

	var eligibility map[string]any
	if err := json.Unmarshal(req.Rules[1].RuleConfig, &eligibility); err != nil {
		t.Fatalf("unmarshal normalized eligibility config: %v", err)
	}
	if eligibility["min_deposits"] != float64(2) {
		t.Fatalf("expected point activity alias to normalize, got %+v", eligibility)
	}
	if eligibility["tier_min"] != "gold" {
		t.Fatalf("expected rank alias to normalize, got %+v", eligibility)
	}
	if _, ok := eligibility["min_point_activity_count"]; ok {
		t.Fatalf("point activity request alias should be normalized before persistence: %+v", eligibility)
	}
	if _, ok := eligibility["rank_min"]; ok {
		t.Fatalf("rank request alias should be normalized before persistence: %+v", eligibility)
	}
}

func TestCreateCampaignRequestNormalizeRetiredPromoCampaignTypes(t *testing.T) {
	for _, tc := range []struct {
		input string
		want  string
	}{
		{input: "freebet_grant", want: "point_grant"},
		{input: "freebet", want: "point_grant"},
		{input: "cash", want: "point_grant"},
		{input: "odds_boost", want: "point_grant"},
		{input: "deposit_match", want: "point_match"},
		{input: "point_grant", want: "point_grant"},
		{input: "point_match", want: "point_match"},
	} {
		t.Run(tc.input, func(t *testing.T) {
			req := CreateCampaignRequest{CampaignType: tc.input}
			req.NormalizePointAliases()
			if req.CampaignType != tc.want {
				t.Fatalf("expected campaign type %q to normalize to %q, got %q", tc.input, tc.want, req.CampaignType)
			}
		})
	}
}

func TestRuleInputNormalizeRetiredRewardConfigTypes(t *testing.T) {
	for _, tc := range []struct {
		input string
		want  string
	}{
		{input: "freebet_grant", want: "point_grant"},
		{input: "freebet", want: "point_grant"},
		{input: "cash", want: "point_grant"},
		{input: "odds_boost", want: "point_grant"},
		{input: "deposit_match", want: "point_match"},
		{input: "point_grant", want: "point_grant"},
		{input: "point_match", want: "point_match"},
	} {
		t.Run(tc.input, func(t *testing.T) {
			rule := RuleInput{
				RuleType: "reward",
				PointRuleConfig: mustRuleConfigForModels(t, map[string]any{
					"type": tc.input,
				}),
			}

			rule.NormalizePointAliases()

			var cfg map[string]any
			if err := json.Unmarshal(rule.RuleConfig, &cfg); err != nil {
				t.Fatalf("unmarshal normalized config: %v", err)
			}
			if cfg["type"] != tc.want {
				t.Fatalf("expected reward type %q to normalize to %q, got %+v", tc.input, tc.want, cfg)
			}
		})
	}
}

func TestRuleInputPrefersPointRuleConfigOverLegacyRuleConfig(t *testing.T) {
	rule := RuleInput{
		RuleType: "reward",
		RuleConfig: mustRuleConfigForModels(t, map[string]any{
			"fixed_amount_points": 999,
			"type":                "cash",
		}),
		PointRuleConfig: mustRuleConfigForModels(t, map[string]any{
			"fixed_amount_points": 500,
			"type":                "point_grant",
		}),
	}

	rule.NormalizePointAliases()

	var cfg map[string]any
	if err := json.Unmarshal(rule.RuleConfig, &cfg); err != nil {
		t.Fatalf("unmarshal normalized config: %v", err)
	}
	if cfg["fixed_amount_points"] != float64(500) {
		t.Fatalf("expected point_rule_config amount to win, got %+v", cfg)
	}
	if cfg["type"] != "point_grant" {
		t.Fatalf("expected point_rule_config type to win, got %+v", cfg)
	}
}

func TestRuleInputLaunchValidationPrefersPointRuleConfigOverLegacyRuleConfig(t *testing.T) {
	rule := RuleInput{
		RuleType: "reward",
		RuleConfig: mustRuleConfigForModels(t, map[string]any{
			"min_odds_decimal": 1.5,
		}),
		PointRuleConfig: mustRuleConfigForModels(t, map[string]any{
			"fixed_amount_points": 3,
		}),
	}

	if err := rule.ValidateLaunchCopy(0); err != nil {
		t.Fatalf("expected preferred point_rule_config to control validation, got %v", err)
	}
}

func TestCreateCampaignRequestSingleBudgetField(t *testing.T) {
	// Points unit-model correction (2026-07-07): the cents-era budget alias
	// is retired; budget_points is the only budget field. This locks the
	// single-field shape so a compat alias can't quietly return.
	points := int64(2000)
	req := CreateCampaignRequest{BudgetPoints: &points}
	if req.BudgetPoints == nil || *req.BudgetPoints != 2000 {
		t.Fatal("budget_points should be the single authoritative budget field")
	}
	if err := req.ValidatePointAliasConflicts(); err != nil {
		t.Fatalf("single budget field must not conflict: %v", err)
	}
}

func TestCreateCampaignRequestRuleAmountSingleKey(t *testing.T) {
	// Post unit-model correction: fixed_amount_points is the single amount
	// key; a conflicting min_points/min_amount_points pair still errors.
	req := CreateCampaignRequest{
		Rules: []RuleInput{
			{
				RuleType: "reward",
				PointRuleConfig: mustRuleConfigForModels(t, map[string]any{
					"fixed_amount_points": 500,
				}),
			},
		},
	}
	if err := req.ValidatePointAliasConflicts(); err != nil {
		t.Fatalf("single amount key must not conflict: %v", err)
	}
	conflicted := CreateCampaignRequest{
		Rules: []RuleInput{
			{
				RuleType: "reward",
				PointRuleConfig: mustRuleConfigForModels(t, map[string]any{
					"min_points":        100,
					"min_amount_points": 200,
				}),
			},
		},
	}
	if err := conflicted.ValidatePointAliasConflicts(); err == nil {
		t.Fatal("expected min_points/min_amount_points conflict to error")
	}
}

func TestCreateCampaignRequestAllowsMatchingRuleAliases(t *testing.T) {
	req := CreateCampaignRequest{
		BudgetPoints: int64PtrForModels(7500),
		Rules: []RuleInput{
			{
				RuleType: "reward",
				PointRuleConfig: mustRuleConfigForModels(t, map[string]any{
					"fixed_amount_points": 500,
					"max_bonus_points":    2500,
					"min_points":          100,
					"min_amount_points":   100,
				}),
			},
		},
	}

	if err := req.ValidatePointAliasConflicts(); err != nil {
		t.Fatalf("expected matching aliases to be accepted, got %v", err)
	}
}

func TestCreateCampaignRequestRejectsProhibitedLaunchCopy(t *testing.T) {
	for _, tc := range []struct {
		name      string
		request   CreateCampaignRequest
		wantField string
	}{
		{
			name:      "name",
			request:   CreateCampaignRequest{Name: "Cash Bonus", Description: "Point-play status only."},
			wantField: "name",
		},
		{
			name:      "description",
			request:   CreateCampaignRequest{Name: "Status Boost", Description: "Redeemable rank rewards for top players."},
			wantField: "description",
		},
		{
			name:      "wagering copy",
			request:   CreateCampaignRequest{Name: "Status Boost", Description: "Complete wagering to earn a freebet."},
			wantField: "description",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.request.ValidateLaunchCopy()
			if err == nil {
				t.Fatal("expected launch-copy error")
			}
			fieldErr, ok := err.(interface{ FieldName() string })
			if !ok {
				t.Fatalf("expected field error, got %T", err)
			}
			if fieldErr.FieldName() != tc.wantField {
				t.Fatalf("expected field %q, got %q", tc.wantField, fieldErr.FieldName())
			}
		})
	}
}

func TestCreateCampaignRequestRejectsProhibitedTriggerEventCopy(t *testing.T) {
	req := CreateCampaignRequest{
		Name:        "Status Boost",
		Description: "Non-redeemable point-play status only.",
		Rules: []RuleInput{
			{
				RuleType: "trigger",
				PointRuleConfig: mustRuleConfigForModels(t, map[string]any{
					"event": "deposit",
				}),
			},
		},
	}

	err := req.ValidateLaunchCopy()
	if err == nil {
		t.Fatal("expected unsafe trigger event to be rejected")
	}
	fieldErr, ok := err.(interface{ FieldName() string })
	if !ok {
		t.Fatalf("expected field error, got %T", err)
	}
	if fieldErr.FieldName() != "rules[0].point_rule_config.event" {
		t.Fatalf("expected trigger event field, got %q", fieldErr.FieldName())
	}
}

func TestCreateCampaignRequestRejectsRetiredEligibilityDepositKey(t *testing.T) {
	req := CreateCampaignRequest{
		Name:        "Status Boost",
		Description: "Non-redeemable point-play status only.",
		Rules: []RuleInput{
			{
				RuleType: "eligibility",
				PointRuleConfig: mustRuleConfigForModels(t, map[string]any{
					"min_deposits": 1,
				}),
			},
		},
	}

	err := req.ValidateLaunchCopy()
	if err == nil {
		t.Fatal("expected retired eligibility key to be rejected")
	}
	fieldErr, ok := err.(interface{ FieldName() string })
	if !ok {
		t.Fatalf("expected field error, got %T", err)
	}
	if fieldErr.FieldName() != "rules[0].point_rule_config.min_point_activity_count" {
		t.Fatalf("expected point activity field, got %q", fieldErr.FieldName())
	}
}

func TestCreateCampaignRequestRejectsRetiredEligibilityRankKey(t *testing.T) {
	req := CreateCampaignRequest{
		Name:        "Status Boost",
		Description: "Non-redeemable point-play status only.",
		Rules: []RuleInput{
			{
				RuleType: "eligibility",
				PointRuleConfig: mustRuleConfigForModels(t, map[string]any{
					"tier_min": "gold",
				}),
			},
		},
	}

	err := req.ValidateLaunchCopy()
	if err == nil {
		t.Fatal("expected retired rank key to be rejected")
	}
	fieldErr, ok := err.(interface{ FieldName() string })
	if !ok {
		t.Fatalf("expected field error, got %T", err)
	}
	if fieldErr.FieldName() != "rules[0].point_rule_config.rank_min" {
		t.Fatalf("expected rank field, got %q", fieldErr.FieldName())
	}
}

func TestCreateCampaignRequestRejectsRetiredPointPlayMechanics(t *testing.T) {
	for _, key := range []string{"min_odds_decimal", "parlay_multiplier", "excluded_sports"} {
		t.Run(key, func(t *testing.T) {
			req := CreateCampaignRequest{
				Name:        "Status Boost",
				Description: "Non-redeemable point-play status only.",
				Rules: []RuleInput{
					{
						RuleType: "reward",
						PointRuleConfig: mustRuleConfigForModels(t, map[string]any{
							key: 1,
						}),
					},
				},
			}

			err := req.ValidateLaunchCopy()
			if err == nil {
				t.Fatal("expected retired point-play mechanic to be rejected")
			}
			fieldErr, ok := err.(interface{ FieldName() string })
			if !ok {
				t.Fatalf("expected field error, got %T", err)
			}
			wantField := "rules[0].point_rule_config." + key
			if fieldErr.FieldName() != wantField {
				t.Fatalf("expected field %q, got %q", wantField, fieldErr.FieldName())
			}
		})
	}
}

func TestCreateCampaignRequestAllowsNonRedeemableDisclosureCopy(t *testing.T) {
	req := CreateCampaignRequest{
		Name:        "Status Boost",
		Description: "Non-redeemable point-play status only.",
	}

	if err := req.ValidateLaunchCopy(); err != nil {
		t.Fatalf("expected safe non-redeemable disclosure copy, got %v", err)
	}
}

func TestGrantBonusRequestSingleOverrideField(t *testing.T) {
	// Points unit-model (2026-07-07): override_points is the single override
	// field; the cents-era alias is retired.
	points := int64(2000)
	req := GrantBonusRequest{UserID: "u-1", CampaignID: 7, OverridePoints: &points}
	req.NormalizePointAliases()
	if req.OverridePoints == nil || *req.OverridePoints != 2000 {
		t.Fatal("override_points should be the single authoritative override field")
	}
}

func mustRuleConfigForModels(t *testing.T, v any) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal rule config: %v", err)
	}
	return b
}

func int64PtrForModels(v int64) *int64 {
	return &v
}
