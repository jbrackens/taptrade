package http

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	stdhttp "net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"taptrade/gateway/internal/bonus"
	"taptrade/platform/transport/httpx"
)

type fakeActiveBonusLister struct {
	calledUserID string
	bonuses      []bonus.PlayerBonus
}

func (f *fakeActiveBonusLister) ListActiveBonuses(_ context.Context, userID string) ([]bonus.PlayerBonus, error) {
	f.calledUserID = userID
	return f.bonuses, nil
}

type fakeBonusClaimer struct {
	calledReq bonus.ClaimBonusRequest
	bonus     bonus.PlayerBonus
	err       error
}

func (f *fakeBonusClaimer) ClaimBonus(_ context.Context, req bonus.ClaimBonusRequest) (bonus.PlayerBonus, error) {
	f.calledReq = req
	if f.err != nil {
		return bonus.PlayerBonus{}, f.err
	}
	return f.bonus, nil
}

type fakePlayerBonusGetter struct {
	calledID int64
	bonus    bonus.PlayerBonus
}

func (f *fakePlayerBonusGetter) GetPlayerBonus(_ context.Context, id int64) (bonus.PlayerBonus, error) {
	f.calledID = id
	return f.bonus, nil
}

type fakeAdminBonusGranter struct {
	calledReq bonus.GrantBonusRequest
	bonus     bonus.PlayerBonus
}

func (f *fakeAdminBonusGranter) GrantBonus(_ context.Context, req bonus.GrantBonusRequest) (bonus.PlayerBonus, error) {
	f.calledReq = req
	return f.bonus, nil
}

type fakeAdminBonusDetailService struct {
	calledGetID      int64
	calledForfeitID  int64
	calledForfeitReq bonus.ForfeitBonusRequest
	bonus            bonus.PlayerBonus
}

func (f *fakeAdminBonusDetailService) GetPlayerBonus(_ context.Context, id int64) (bonus.PlayerBonus, error) {
	f.calledGetID = id
	return f.bonus, nil
}

func (f *fakeAdminBonusDetailService) ForfeitPlayerBonus(_ context.Context, bonusID int64, req bonus.ForfeitBonusRequest) error {
	f.calledForfeitID = bonusID
	f.calledForfeitReq = req
	return nil
}

func decodeErrorMessageAndField(t *testing.T, rec *httptest.ResponseRecorder) (string, string) {
	t.Helper()
	var payload struct {
		Error struct {
			Message string         `json:"message"`
			Details map[string]any `json:"details"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode error response: %v; body=%s", err, rec.Body.String())
	}
	field, _ := payload.Error.Details["field"].(string)
	return payload.Error.Message, field
}

func TestPlayerBonusResponseUsesPointNativeContract(t *testing.T) {
	grantedAt := time.Date(2026, 6, 24, 9, 30, 0, 0, time.UTC)
	expiresAt := grantedAt.Add(72 * time.Hour)
	metadata, _ := json.Marshal(map[string]any{"campaign_name": "Welcome Points"})
	pb := bonus.PlayerBonus{
		ID:                    42,
		UserID:                "u-bonus-1",
		BonusType:             "signup_bonus",
		Status:                "active",
		GrantedAmountPoints:   5000,
		RemainingAmountPoints: 3500,
		ExpiresAt:             expiresAt,
		GrantedAt:             grantedAt,
		Metadata:              metadata,
	}

	payload := playerBonusResponse(pb, campaignNameFromBonus(pb))

	if payload["unit"] != "PTS" {
		t.Fatalf("expected point unit, got %v", payload["unit"])
	}
	if payload["campaignName"] != "Welcome Points" || payload["campaign_name"] != "Welcome Points" {
		t.Fatalf("expected campaign name aliases, got %+v", payload)
	}
	if payload["grantedPoints"] != int64(5000) {
		t.Fatalf("expected granted points, got %+v", payload)
	}
	if payload["remainingPoints"] != int64(3500) {
		t.Fatalf("expected remaining points, got %+v", payload)
	}
	for _, retired := range []string{
		"grantedAmountPoints",
		"granted_amount_points",
		"remainingAmountPoints",
		"remaining_amount_points",
		"wageringRequiredPoints",
		"wagering_required_points",
		"wageringCompletedPoints",
		"wagering_completed_points",
		"wageringProgressPct",
		"wagering_progress_pct",
		"playRequiredPoints",
		"playCompletedPoints",
		"playProgressPct",
	} {
		if _, ok := payload[retired]; ok {
			t.Fatalf("retired player bonus field %q leaked in %+v", retired, payload)
		}
	}
}

func TestPlayerBonusResponseMapsRetiredPromoType(t *testing.T) {
	pb := bonus.PlayerBonus{
		ID:        43,
		BonusType: "freebet_grant",
		ExpiresAt: time.Date(2026, 6, 27, 12, 0, 0, 0, time.UTC),
		GrantedAt: time.Date(2026, 6, 24, 12, 0, 0, 0, time.UTC),
	}

	payload := playerBonusResponse(pb, "Point Grant")

	if payload["bonusType"] != "point_grant" || payload["bonus_type"] != "point_grant" {
		t.Fatalf("expected point_grant bonus type aliases, got %+v", payload)
	}
}

func TestPlayerBonusResponseRedactsLegacyUnsafeCampaignNameWithoutMutatingMetadata(t *testing.T) {
	metadata, _ := json.Marshal(map[string]any{"campaign_name": "Cash prize payout"})
	pb := bonus.PlayerBonus{
		ID:        44,
		BonusType: "signup_bonus",
		ExpiresAt: time.Date(2026, 6, 27, 12, 0, 0, 0, time.UTC),
		GrantedAt: time.Date(2026, 6, 24, 12, 0, 0, 0, time.UTC),
		Metadata:  metadata,
	}

	payload := playerBonusResponse(pb, campaignNameFromBonus(pb))

	if payload["campaignName"] != launchRedactedUserText || payload["campaign_name"] != launchRedactedUserText {
		t.Fatalf("expected unsafe campaign aliases redacted, got %+v", payload)
	}
	if campaignNameFromBonus(pb) != "Cash prize payout" {
		t.Fatalf("playerBonusResponse must not mutate raw campaign metadata, got %s", string(pb.Metadata))
	}
}

func TestAdminCreateCampaignRejectsRetiredBudgetAliasAtHTTPBoundary(t *testing.T) {
	svc := bonus.NewService(bonus.NewRepository(nil), nil, nil)
	req := httptest.NewRequest(
		stdhttp.MethodPost,
		"/api/v1/admin/campaigns",
		bytes.NewBufferString(`{
			"name":"Launch Points",
			"campaign_type":"custom",
			"start_at":"2026-06-27T00:00:00Z",
			"end_at":"2026-06-28T00:00:00Z",
			"budget_points":1000,
			"budget_cents":2000,
			"rules":[]
		}`),
	)
	req = req.WithContext(httpx.WithTestUser(req.Context(), "admin-1", "admin@taptrade.local", "admin"))
	rec := httptest.NewRecorder()

	httpx.Handle(adminCampaignsHandler(svc)).ServeHTTP(rec, req)

	if rec.Code != stdhttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
	message, field := decodeErrorMessageAndField(t, rec)
	if message != "admin campaign budget must use budget_points" {
		t.Fatalf("expected point-native retired-alias message, got %q", message)
	}
	if field != "budget_points" {
		t.Fatalf("expected point-native alias field, got %q", field)
	}
}

func TestAdminCreateCampaignRejectsRetiredRuleAmountAliasAtHTTPBoundary(t *testing.T) {
	svc := bonus.NewService(bonus.NewRepository(nil), nil, nil)
	req := httptest.NewRequest(
		stdhttp.MethodPost,
		"/api/v1/admin/campaigns",
		bytes.NewBufferString(`{
			"name":"Launch Points",
			"campaign_type":"custom",
			"start_at":"2026-06-27T00:00:00Z",
			"end_at":"2026-06-28T00:00:00Z",
			"budget_points":1000,
			"rules":[{
				"rule_type":"reward",
				"point_rule_config":{
					"fixed_amount_cents":500
				}
			}]
		}`),
	)
	req = req.WithContext(httpx.WithTestUser(req.Context(), "admin-1", "admin@taptrade.local", "admin"))
	rec := httptest.NewRecorder()

	httpx.Handle(adminCampaignsHandler(svc)).ServeHTTP(rec, req)

	if rec.Code != stdhttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
	message, field := decodeErrorMessageAndField(t, rec)
	if message != "admin campaign rule config must use point-native amount fields" {
		t.Fatalf("expected point-native rule alias message, got %q", message)
	}
	if field != "rules[0].point_rule_config.fixed_amount_points" {
		t.Fatalf("expected nested point-native field, got %q", field)
	}
}

func TestAdminCreateCampaignRejectsRetiredRequestContractAtHTTPBoundary(t *testing.T) {
	cases := []struct {
		name        string
		body        string
		wantMessage string
		wantField   string
	}{
		{
			name: "legacy_rule_config",
			body: `{
				"name":"Launch Points",
				"campaign_type":"custom",
				"start_at":"2026-06-27T00:00:00Z",
				"end_at":"2026-06-28T00:00:00Z",
				"budget_points":1000,
				"rules":[{"rule_type":"reward","rule_config":{"fixed_amount_points":500}}]
			}`,
			wantMessage: "admin campaign rules must use point_rule_config",
			wantField:   "rules[0].point_rule_config",
		},
		{
			name: "retired_campaign_type",
			body: `{
				"name":"Launch Points",
				"campaign_type":"freebet_grant",
				"start_at":"2026-06-27T00:00:00Z",
				"end_at":"2026-06-28T00:00:00Z",
				"budget_points":1000,
				"rules":[]
			}`,
			wantMessage: "admin campaign type must use point-native type",
			wantField:   "campaign_type",
		},
		{
			name: "retired_reward_type",
			body: `{
				"name":"Launch Points",
				"campaign_type":"custom",
				"start_at":"2026-06-27T00:00:00Z",
				"end_at":"2026-06-28T00:00:00Z",
				"budget_points":1000,
				"rules":[{"rule_type":"reward","point_rule_config":{"type":"deposit_match","fixed_amount_points":500}}]
			}`,
			wantMessage: "admin campaign reward type must use point-native type",
			wantField:   "rules[0].point_rule_config.type",
		},
		{
			name: "retired_stake_contribution_alias",
			body: `{
				"name":"Launch Points",
				"campaign_type":"custom",
				"start_at":"2026-06-27T00:00:00Z",
				"end_at":"2026-06-28T00:00:00Z",
				"budget_points":1000,
				"rules":[{"rule_type":"reward","point_rule_config":{"max_stake_contribution_cents":500}}]
			}`,
			wantMessage: "admin campaign rule config must use point-native amount fields",
			wantField:   "rules[0].point_rule_config.max_play_contribution_points",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc := bonus.NewService(bonus.NewRepository(nil), nil, nil)
			req := httptest.NewRequest(stdhttp.MethodPost, "/api/v1/admin/campaigns", bytes.NewBufferString(tc.body))
			req = req.WithContext(httpx.WithTestUser(req.Context(), "admin-1", "admin@taptrade.local", "admin"))
			rec := httptest.NewRecorder()

			httpx.Handle(adminCampaignsHandler(svc)).ServeHTTP(rec, req)

			if rec.Code != stdhttp.StatusBadRequest {
				t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
			}
			message, field := decodeErrorMessageAndField(t, rec)
			if message != tc.wantMessage {
				t.Fatalf("expected message %q, got %q", tc.wantMessage, message)
			}
			if field != tc.wantField {
				t.Fatalf("expected field %q, got %q", tc.wantField, field)
			}
		})
	}
}

func TestAdminCreateCampaignRejectsProhibitedNameCopyAtHTTPBoundary(t *testing.T) {
	svc := bonus.NewService(bonus.NewRepository(nil), nil, nil)
	req := httptest.NewRequest(
		stdhttp.MethodPost,
		"/api/v1/admin/campaigns",
		bytes.NewBufferString(`{
			"name":"Cash Bonus",
			"description":"Point-play status only.",
			"campaign_type":"custom",
			"start_at":"2026-06-27T00:00:00Z",
			"end_at":"2026-06-28T00:00:00Z",
			"budget_points":1000,
			"rules":[]
		}`),
	)
	req = req.WithContext(httpx.WithTestUser(req.Context(), "admin-1", "admin@taptrade.local", "admin"))
	rec := httptest.NewRecorder()

	httpx.Handle(adminCampaignsHandler(svc)).ServeHTTP(rec, req)

	if rec.Code != stdhttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
	message, field := decodeErrorMessageAndField(t, rec)
	if message != "campaign name must use non-redeemable point-play wording" {
		t.Fatalf("expected launch-copy message, got %q", message)
	}
	if field != "name" {
		t.Fatalf("expected name field, got %q", field)
	}
}

func TestAdminCreateCampaignRejectsRedeemableDescriptionCopyAtHTTPBoundary(t *testing.T) {
	svc := bonus.NewService(bonus.NewRepository(nil), nil, nil)
	req := httptest.NewRequest(
		stdhttp.MethodPost,
		"/api/v1/admin/campaigns",
		bytes.NewBufferString(`{
			"name":"Status Boost",
			"description":"Redeemable rank rewards for top players.",
			"campaign_type":"custom",
			"start_at":"2026-06-27T00:00:00Z",
			"end_at":"2026-06-28T00:00:00Z",
			"budget_points":1000,
			"rules":[]
		}`),
	)
	req = req.WithContext(httpx.WithTestUser(req.Context(), "admin-1", "admin@taptrade.local", "admin"))
	rec := httptest.NewRecorder()

	httpx.Handle(adminCampaignsHandler(svc)).ServeHTTP(rec, req)

	if rec.Code != stdhttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
	message, field := decodeErrorMessageAndField(t, rec)
	if message != "campaign description must use non-redeemable point-play wording" {
		t.Fatalf("expected launch-copy message, got %q", message)
	}
	if field != "description" {
		t.Fatalf("expected description field, got %q", field)
	}
}

func TestCampaignActionResponseUsesPointNativeUnit(t *testing.T) {
	for _, status := range []string{"active", "paused", "closed"} {
		payload := campaignActionResponse(status)
		if payload["status"] != status {
			t.Fatalf("expected status %q, got %+v", status, payload)
		}
		if payload["unit"] != "PTS" {
			t.Fatalf("expected PTS unit for status %q, got %+v", status, payload)
		}
	}
}

func TestAdminCreateCampaignRejectsProhibitedTriggerEventAtHTTPBoundary(t *testing.T) {
	svc := bonus.NewService(bonus.NewRepository(nil), nil, nil)
	req := httptest.NewRequest(
		stdhttp.MethodPost,
		"/api/v1/admin/campaigns",
		bytes.NewBufferString(`{
			"name":"Status Boost",
			"description":"Non-redeemable point-play status only.",
			"campaign_type":"custom",
			"start_at":"2026-06-27T00:00:00Z",
			"end_at":"2026-06-28T00:00:00Z",
			"budget_points":1000,
			"rules":[{
				"rule_type":"trigger",
				"point_rule_config":{"event":"deposit"}
			}]
		}`),
	)
	req = req.WithContext(httpx.WithTestUser(req.Context(), "admin-1", "admin@taptrade.local", "admin"))
	rec := httptest.NewRecorder()

	httpx.Handle(adminCampaignsHandler(svc)).ServeHTTP(rec, req)

	if rec.Code != stdhttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
	message, field := decodeErrorMessageAndField(t, rec)
	if message != "campaign trigger event must use point-native wording" {
		t.Fatalf("expected trigger event message, got %q", message)
	}
	if field != "rules[0].point_rule_config.event" {
		t.Fatalf("expected trigger event field, got %q", field)
	}
}

func TestAdminCreateCampaignRejectsRetiredEligibilityDepositKeyAtHTTPBoundary(t *testing.T) {
	svc := bonus.NewService(bonus.NewRepository(nil), nil, nil)
	req := httptest.NewRequest(
		stdhttp.MethodPost,
		"/api/v1/admin/campaigns",
		bytes.NewBufferString(`{
			"name":"Status Boost",
			"description":"Non-redeemable point-play status only.",
			"campaign_type":"custom",
			"start_at":"2026-06-27T00:00:00Z",
			"end_at":"2026-06-28T00:00:00Z",
			"budget_points":1000,
			"rules":[{
				"rule_type":"eligibility",
				"point_rule_config":{"min_deposits":1}
			}]
		}`),
	)
	req = req.WithContext(httpx.WithTestUser(req.Context(), "admin-1", "admin@taptrade.local", "admin"))
	rec := httptest.NewRecorder()

	httpx.Handle(adminCampaignsHandler(svc)).ServeHTTP(rec, req)

	if rec.Code != stdhttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
	message, field := decodeErrorMessageAndField(t, rec)
	if message != "campaign eligibility must use point-native activity wording" {
		t.Fatalf("expected eligibility message, got %q", message)
	}
	if field != "rules[0].point_rule_config.min_point_activity_count" {
		t.Fatalf("expected point activity field, got %q", field)
	}
}

func TestAdminCreateCampaignRejectsRetiredEligibilityRankKeyAtHTTPBoundary(t *testing.T) {
	svc := bonus.NewService(bonus.NewRepository(nil), nil, nil)
	req := httptest.NewRequest(
		stdhttp.MethodPost,
		"/api/v1/admin/campaigns",
		bytes.NewBufferString(`{
			"name":"Status Boost",
			"description":"Non-redeemable point-play status only.",
			"campaign_type":"custom",
			"start_at":"2026-06-27T00:00:00Z",
			"end_at":"2026-06-28T00:00:00Z",
			"budget_points":1000,
			"rules":[{
				"rule_type":"eligibility",
				"point_rule_config":{"tier_min":"gold"}
			}]
		}`),
	)
	req = req.WithContext(httpx.WithTestUser(req.Context(), "admin-1", "admin@taptrade.local", "admin"))
	rec := httptest.NewRecorder()

	httpx.Handle(adminCampaignsHandler(svc)).ServeHTTP(rec, req)

	if rec.Code != stdhttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
	message, field := decodeErrorMessageAndField(t, rec)
	if message != "campaign eligibility must use point-native rank wording" {
		t.Fatalf("expected eligibility rank message, got %q", message)
	}
	if field != "rules[0].point_rule_config.rank_min" {
		t.Fatalf("expected rank field, got %q", field)
	}
}

func TestAdminCreateCampaignRejectsRetiredPointPlayMechanicAtHTTPBoundary(t *testing.T) {
	svc := bonus.NewService(bonus.NewRepository(nil), nil, nil)
	req := httptest.NewRequest(
		stdhttp.MethodPost,
		"/api/v1/admin/campaigns",
		bytes.NewBufferString(`{
			"name":"Status Boost",
			"description":"Non-redeemable point-play status only.",
			"campaign_type":"custom",
			"start_at":"2026-06-27T00:00:00Z",
			"end_at":"2026-06-28T00:00:00Z",
			"budget_points":1000,
			"rules":[{
				"rule_type":"reward",
				"point_rule_config":{"min_odds_decimal":1.5}
			}]
		}`),
	)
	req = req.WithContext(httpx.WithTestUser(req.Context(), "admin-1", "admin@taptrade.local", "admin"))
	rec := httptest.NewRecorder()

	httpx.Handle(adminCampaignsHandler(svc)).ServeHTTP(rec, req)

	if rec.Code != stdhttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
	message, field := decodeErrorMessageAndField(t, rec)
	if message != "campaign point-play rules must use launch point-play mechanics" {
		t.Fatalf("expected point-play mechanic message, got %q", message)
	}
	if field != "rules[0].point_rule_config.min_odds_decimal" {
		t.Fatalf("expected point-play mechanic field, got %q", field)
	}
}

func TestAdminGrantBonusEndpointUsesSessionAdminAndPointNativePayload(t *testing.T) {
	grantedAt := time.Date(2026, 6, 24, 9, 30, 0, 0, time.UTC)
	metadata, _ := json.Marshal(map[string]any{
		"campaign_name": "Manual Point-Play Bonus",
		"granted_by":    "admin-1",
		"admin_grant":   true,
	})
	overridePoints := int64(20000)
	granter := &fakeAdminBonusGranter{
		bonus: bonus.PlayerBonus{
			ID:                    195,
			UserID:                "u-1",
			BonusType:             "custom",
			Status:                "active",
			GrantedAmountPoints:   20000,
			RemainingAmountPoints: 20000,
			ExpiresAt:             grantedAt.Add(14 * 24 * time.Hour),
			GrantedAt:             grantedAt,
			Metadata:              metadata,
		},
	}

	req := httptest.NewRequest(
		stdhttp.MethodPost,
		"/api/v1/admin/bonuses/grant",
		bytes.NewBufferString(`{"user_id":"u-1","campaign_id":77,"override_points":20000,"reason":"manual launch proof"}`),
	)
	req = req.WithContext(httpx.WithTestUser(req.Context(), "admin-1", "admin@taptrade.local", "admin"))
	rec := httptest.NewRecorder()

	httpx.Handle(adminGrantBonusHandler(granter)).ServeHTTP(rec, req)

	if rec.Code != stdhttp.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	if granter.calledReq.GrantedBy != "admin-1" {
		t.Fatalf("expected grant actor from admin session, got %+v", granter.calledReq)
	}
	if granter.calledReq.UserID != "u-1" || granter.calledReq.CampaignID != 77 || granter.calledReq.Reason != "manual launch proof" {
		t.Fatalf("expected grant request body fields to pass through, got %+v", granter.calledReq)
	}
	if granter.calledReq.OverridePoints == nil || *granter.calledReq.OverridePoints != overridePoints {
		t.Fatalf("expected preferred override point alias, got %+v", granter.calledReq)
	}
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode admin grant response: %v", err)
	}
	if got["unit"] != "PTS" {
		t.Fatalf("expected point unit, got %+v", got)
	}
	if got["campaignName"] != "Manual Point-Play Bonus" {
		t.Fatalf("expected campaign name, got %+v", got)
	}
	if got["grantedPoints"] != float64(20000) || got["remainingPoints"] != float64(20000) {
		t.Fatalf("expected point grant fields, got %+v", got)
	}
	for _, retired := range []string{
		"grantedAmountPoints",
		"remainingAmountPoints",
		"wageringRequiredPoints",
		"wageringCompletedPoints",
		"wageringProgressPct",
		"progressPct",
	} {
		if _, ok := got[retired]; ok {
			t.Fatalf("retired admin grant field %q leaked in %+v", retired, got)
		}
	}
}

func TestAdminGrantBonusRejectsRetiredOverrideAliasAtHTTPBoundary(t *testing.T) {
	svc := bonus.NewService(bonus.NewRepository(nil), nil, nil)
	req := httptest.NewRequest(
		stdhttp.MethodPost,
		"/api/v1/admin/bonuses/grant",
		bytes.NewBufferString(`{
			"user_id":"u-1",
			"campaign_id":77,
			"override_points":1000,
			"override_amount_points":2000,
			"reason":"manual launch proof"
		}`),
	)
	req = req.WithContext(httpx.WithTestUser(req.Context(), "admin-1", "admin@taptrade.local", "admin"))
	rec := httptest.NewRecorder()

	httpx.Handle(adminGrantBonusHandler(svc)).ServeHTTP(rec, req)

	if rec.Code != stdhttp.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
	message, field := decodeErrorMessageAndField(t, rec)
	if message != "admin bonus grant override must use override_points" {
		t.Fatalf("expected point-native retired-alias message, got %q", message)
	}
	if field != "override_points" {
		t.Fatalf("expected point-native alias field, got %q", field)
	}
}

func TestAdminGrantBonusRejectsMoneyWordingReason(t *testing.T) {
	granter := &fakeAdminBonusGranter{}
	req := httptest.NewRequest(
		stdhttp.MethodPost,
		"/api/v1/admin/bonuses/grant",
		bytes.NewBufferString(`{"user_id":"u-1","campaign_id":77,"override_points":20000,"reason":"cash payout grant"}`),
	)
	req = req.WithContext(httpx.WithTestUser(req.Context(), "admin-1", "admin@taptrade.local", "admin"))
	rec := httptest.NewRecorder()

	httpx.Handle(adminGrantBonusHandler(granter)).ServeHTTP(rec, req)

	if rec.Code != stdhttp.StatusBadRequest {
		t.Fatalf("expected 400 for unsafe grant reason, got %d: %s", rec.Code, rec.Body.String())
	}
	message, field := decodeErrorMessageAndField(t, rec)
	if field != "reason" {
		t.Fatalf("expected reason field, got message=%q field=%q", message, field)
	}
	if strings.Contains(rec.Body.String(), "cash payout") {
		t.Fatalf("unsafe grant reason should not be echoed: %s", rec.Body.String())
	}
	if granter.calledReq.UserID != "" || granter.calledReq.Reason != "" {
		t.Fatalf("unsafe grant reason should not call service, got %+v", granter.calledReq)
	}
}

func TestAdminBonusForfeitEndpointUsesSessionAdmin(t *testing.T) {
	svc := &fakeAdminBonusDetailService{}

	req := httptest.NewRequest(
		stdhttp.MethodPost,
		"/api/v1/admin/bonuses/195/forfeit",
		bytes.NewBufferString(`{"reason":"manual review"}`),
	)
	req = req.WithContext(httpx.WithTestUser(req.Context(), "admin-1", "admin@taptrade.local", "admin"))
	rec := httptest.NewRecorder()

	httpx.Handle(adminBonusDetailHandler(svc)).ServeHTTP(rec, req)

	if rec.Code != stdhttp.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if svc.calledForfeitID != 195 {
		t.Fatalf("expected forfeit id 195, got %d", svc.calledForfeitID)
	}
	if svc.calledForfeitReq.ForfeitedBy != "admin-1" || svc.calledForfeitReq.Reason != "manual review" {
		t.Fatalf("expected forfeit actor/reason from request context/body, got %+v", svc.calledForfeitReq)
	}
	var got map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode forfeit response: %v", err)
	}
	if got["status"] != "forfeited" {
		t.Fatalf("expected forfeited status, got %+v", got)
	}
	if got["unit"] != "PTS" {
		t.Fatalf("expected point unit, got %+v", got)
	}
}

func TestAdminBonusForfeitRejectsMoneyWordingReason(t *testing.T) {
	svc := &fakeAdminBonusDetailService{}

	req := httptest.NewRequest(
		stdhttp.MethodPost,
		"/api/v1/admin/bonuses/195/forfeit",
		bytes.NewBufferString(`{"reason":"redeemable prize reversal"}`),
	)
	req = req.WithContext(httpx.WithTestUser(req.Context(), "admin-1", "admin@taptrade.local", "admin"))
	rec := httptest.NewRecorder()

	httpx.Handle(adminBonusDetailHandler(svc)).ServeHTTP(rec, req)

	if rec.Code != stdhttp.StatusBadRequest {
		t.Fatalf("expected 400 for unsafe forfeit reason, got %d: %s", rec.Code, rec.Body.String())
	}
	message, field := decodeErrorMessageAndField(t, rec)
	if field != "reason" {
		t.Fatalf("expected reason field, got message=%q field=%q", message, field)
	}
	if strings.Contains(rec.Body.String(), "redeemable prize") {
		t.Fatalf("unsafe forfeit reason should not be echoed: %s", rec.Body.String())
	}
	if svc.calledForfeitID != 0 || svc.calledForfeitReq.Reason != "" {
		t.Fatalf("unsafe forfeit reason should not call service, got id=%d req=%+v", svc.calledForfeitID, svc.calledForfeitReq)
	}
}

func TestPlayerActiveBonusesEndpointReturnsDemoPointPlayPayload(t *testing.T) {
	grantedAt := time.Date(2026, 6, 24, 9, 30, 0, 0, time.UTC)
	metadata, _ := json.Marshal(map[string]any{
		"campaign_name": "Demo Point-Play Bonus",
		"granted_by":    "demo-seed",
		"demo_seed":     true,
	})
	lister := &fakeActiveBonusLister{
		bonuses: []bonus.PlayerBonus{{
			ID:                    190,
			UserID:                "u-1",
			BonusType:             "custom",
			Status:                "active",
			GrantedAmountPoints:   20000,
			RemainingAmountPoints: 15000,
			ExpiresAt:             grantedAt.Add(14 * 24 * time.Hour),
			GrantedAt:             grantedAt,
			Metadata:              metadata,
		}},
	}

	req := httptest.NewRequest(stdhttp.MethodGet, "/api/v1/bonuses/active", nil)
	req = req.WithContext(httpx.WithTestUser(req.Context(), "u-1", "demo@taptrade.local", "player"))
	rec := httptest.NewRecorder()

	httpx.Handle(playerActiveBonusesHandler(lister)).ServeHTTP(rec, req)

	if rec.Code != stdhttp.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if lister.calledUserID != "u-1" {
		t.Fatalf("expected handler to list active bonuses for session user u-1, got %q", lister.calledUserID)
	}
	var body struct {
		Bonuses []map[string]any `json:"bonuses"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode active bonus response: %v", err)
	}
	if len(body.Bonuses) != 1 {
		t.Fatalf("expected one active bonus, got %+v", body)
	}
	got := body.Bonuses[0]
	if got["unit"] != "PTS" {
		t.Fatalf("expected point unit, got %+v", got)
	}
	if got["campaignName"] != "Demo Point-Play Bonus" {
		t.Fatalf("expected demo campaign name, got %+v", got)
	}
	if got["remainingPoints"] != float64(15000) {
		t.Fatalf("expected demo remaining points, got %+v", got)
	}
	for _, retired := range []string{
		"remainingAmountPoints",
		"wageringRequiredPoints",
		"wageringCompletedPoints",
		"wageringProgressPct",
		"progressPct",
	} {
		if _, ok := got[retired]; ok {
			t.Fatalf("retired active bonus field %q leaked in %+v", retired, got)
		}
	}
}

func TestClaimBonusEndpointUsesSessionUserAndPointNativePayload(t *testing.T) {
	grantedAt := time.Date(2026, 6, 24, 9, 30, 0, 0, time.UTC)
	metadata, _ := json.Marshal(map[string]any{
		"campaign_name": "Demo Point-Play Bonus",
		"granted_by":    "demo-seed",
		"demo_seed":     true,
	})
	claimer := &fakeBonusClaimer{
		bonus: bonus.PlayerBonus{
			ID:                    191,
			UserID:                "u-1",
			BonusType:             "custom",
			Status:                "active",
			GrantedAmountPoints:   20000,
			RemainingAmountPoints: 15000,
			ExpiresAt:             grantedAt.Add(14 * 24 * time.Hour),
			GrantedAt:             grantedAt,
			Metadata:              metadata,
		},
	}

	req := httptest.NewRequest(
		stdhttp.MethodPost,
		"/api/v1/bonuses/claim",
		bytes.NewBufferString(`{"campaign_id":77,"trigger_reference":"demo-rewards-panel","user_id":"u-attacker"}`),
	)
	req = req.WithContext(httpx.WithTestUser(req.Context(), "u-1", "demo@taptrade.local", "player"))
	rec := httptest.NewRecorder()

	httpx.Handle(claimBonusHandler(claimer)).ServeHTTP(rec, req)

	if rec.Code != stdhttp.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	if claimer.calledReq.UserID != "u-1" {
		t.Fatalf("expected claim to use session user u-1, got %+v", claimer.calledReq)
	}
	if claimer.calledReq.CampaignID != 77 || claimer.calledReq.TriggerReference != "demo-rewards-panel" {
		t.Fatalf("expected campaign and trigger reference from request body, got %+v", claimer.calledReq)
	}
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode claim response: %v", err)
	}
	if got["unit"] != "PTS" {
		t.Fatalf("expected point unit, got %+v", got)
	}
	if got["campaignName"] != "Demo Point-Play Bonus" {
		t.Fatalf("expected demo campaign name, got %+v", got)
	}
	if got["grantedPoints"] != float64(20000) {
		t.Fatalf("expected granted points, got %+v", got)
	}
	if got["remainingPoints"] != float64(15000) {
		t.Fatalf("expected remaining points, got %+v", got)
	}
	for _, retired := range []string{
		"grantedAmountPoints",
		"remainingAmountPoints",
		"wageringRequiredPoints",
		"wageringCompletedPoints",
		"wageringProgressPct",
		"progressPct",
	} {
		if _, ok := got[retired]; ok {
			t.Fatalf("retired claim field %q leaked in %+v", retired, got)
		}
	}
}

func TestClaimBonusEndpointReturnsPointSafeEligibilityReviewError(t *testing.T) {
	claimer := &fakeBonusClaimer{
		err: fmt.Errorf("campaign eligibility requires verified point activity or rank review before this direct claim"),
	}
	req := httptest.NewRequest(
		stdhttp.MethodPost,
		"/api/v1/bonuses/claim",
		bytes.NewBufferString(`{"campaign_id":77}`),
	)
	req = req.WithContext(httpx.WithTestUser(req.Context(), "u-1", "demo@taptrade.local", "player"))
	rec := httptest.NewRecorder()

	httpx.Handle(claimBonusHandler(claimer)).ServeHTTP(rec, req)

	if rec.Code != stdhttp.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", rec.Code, rec.Body.String())
	}
	var got map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode eligibility response: %v", err)
	}
	if got["error"] != "campaign eligibility requires verified point activity or rank review before this direct claim" {
		t.Fatalf("unexpected error message: %+v", got)
	}
	for _, unsafe := range []string{"GrantBonus", "wire eligibility", "admin grant"} {
		if strings.Contains(rec.Body.String(), unsafe) {
			t.Fatalf("claim error leaked backend/admin wording %q: %s", unsafe, rec.Body.String())
		}
	}
	if claimer.calledReq.UserID != "u-1" {
		t.Fatalf("expected session user on rejected claim, got %+v", claimer.calledReq)
	}
}

func TestClaimBonusEndpointRedactsUnsafeEligibilityError(t *testing.T) {
	claimer := &fakeBonusClaimer{
		err: fmt.Errorf("cash payout campaign is not eligible for direct claim"),
	}
	req := httptest.NewRequest(
		stdhttp.MethodPost,
		"/api/v1/bonuses/claim",
		bytes.NewBufferString(`{"campaign_id":77}`),
	)
	req = req.WithContext(httpx.WithTestUser(req.Context(), "u-1", "demo@taptrade.local", "player"))
	rec := httptest.NewRecorder()

	httpx.Handle(claimBonusHandler(claimer)).ServeHTTP(rec, req)

	if rec.Code != stdhttp.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", rec.Code, rec.Body.String())
	}
	var got map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode unsafe eligibility response: %v", err)
	}
	if got["error"] != launchRedactedUserText {
		t.Fatalf("expected redacted error message, got %+v", got)
	}
	if strings.Contains(rec.Body.String(), "cash payout") {
		t.Fatalf("unsafe claim error leaked: %s", rec.Body.String())
	}
	if claimer.calledReq.UserID != "u-1" {
		t.Fatalf("expected session user on rejected claim, got %+v", claimer.calledReq)
	}
}

func TestClaimBonusEndpointReturnsPointSafeTriggerReviewError(t *testing.T) {
	claimer := &fakeBonusClaimer{
		err: fmt.Errorf("campaign requires verified point activity or admin review before this direct claim"),
	}
	req := httptest.NewRequest(
		stdhttp.MethodPost,
		"/api/v1/bonuses/claim",
		bytes.NewBufferString(`{"campaign_id":77}`),
	)
	req = req.WithContext(httpx.WithTestUser(req.Context(), "u-1", "demo@taptrade.local", "player"))
	rec := httptest.NewRecorder()

	httpx.Handle(claimBonusHandler(claimer)).ServeHTTP(rec, req)

	if rec.Code != stdhttp.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", rec.Code, rec.Body.String())
	}
	var got map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode trigger response: %v", err)
	}
	if got["error"] != "campaign requires verified point activity or admin review before this direct claim" {
		t.Fatalf("unexpected error message: %+v", got)
	}
	for _, unsafe := range []string{"GrantBonus", "wire trigger", "freebet"} {
		if strings.Contains(rec.Body.String(), unsafe) {
			t.Fatalf("claim trigger error leaked backend/admin wording %q: %s", unsafe, rec.Body.String())
		}
	}
	if claimer.calledReq.UserID != "u-1" {
		t.Fatalf("expected session user on rejected claim, got %+v", claimer.calledReq)
	}
}

func TestPlayerBonusProgressEndpointRequiresOwnerAndPointPlayPayload(t *testing.T) {
	grantedAt := time.Date(2026, 6, 24, 9, 30, 0, 0, time.UTC)
	getter := &fakePlayerBonusGetter{
		bonus: bonus.PlayerBonus{
			ID:                    190,
			UserID:                "u-1",
			BonusType:             "custom",
			Status:                "active",
			GrantedAmountPoints:   20000,
			RemainingAmountPoints: 15000,
			ExpiresAt:             grantedAt.Add(14 * 24 * time.Hour),
			GrantedAt:             grantedAt,
		},
	}

	req := httptest.NewRequest(stdhttp.MethodGet, "/api/v1/bonuses/190/progress", nil)
	req = req.WithContext(httpx.WithTestUser(req.Context(), "u-1", "demo@taptrade.local", "player"))
	rec := httptest.NewRecorder()

	httpx.Handle(playerBonusDetailHandler(getter)).ServeHTTP(rec, req)

	if rec.Code != stdhttp.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if getter.calledID != 190 {
		t.Fatalf("expected handler to load bonus 190, got %d", getter.calledID)
	}
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode progress response: %v", err)
	}
	if got["unit"] != "PTS" {
		t.Fatalf("expected point unit, got %+v", got)
	}
	if got["bonusId"] != float64(190) {
		t.Fatalf("expected bonus id, got %+v", got)
	}
	for _, retired := range []string{
		"wageringRequiredPoints",
		"wageringCompletedPoints",
		"wageringProgressPct",
		"progressPct",
	} {
		if _, ok := got[retired]; ok {
			t.Fatalf("retired progress field %q leaked in %+v", retired, got)
		}
	}
}

func TestPlayerBonusDetailEndpointRejectsNonOwner(t *testing.T) {
	getter := &fakePlayerBonusGetter{
		bonus: bonus.PlayerBonus{
			ID:     190,
			UserID: "u-1",
			Status: "active",
		},
	}

	req := httptest.NewRequest(stdhttp.MethodGet, "/api/v1/bonuses/190", nil)
	req = req.WithContext(httpx.WithTestUser(req.Context(), "u-2", "other@taptrade.local", "player"))
	rec := httptest.NewRecorder()

	httpx.Handle(playerBonusDetailHandler(getter)).ServeHTTP(rec, req)

	if rec.Code != stdhttp.StatusForbidden {
		t.Fatalf("expected 403 for non-owner bonus read, got %d: %s", rec.Code, rec.Body.String())
	}
	var body httpx.ErrorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode forbidden response: %v", err)
	}
	if body.Error.Code != httpx.CodeForbidden {
		t.Fatalf("expected forbidden error code, got %+v", body)
	}
}

func TestDemoSeededBonusActiveResponseUsesPointPlayContract(t *testing.T) {
	grantedAt := time.Date(2026, 6, 24, 9, 30, 0, 0, time.UTC)
	expiresAt := grantedAt.Add(14 * 24 * time.Hour)
	metadata, _ := json.Marshal(map[string]any{
		"campaign_name": "Demo Point-Play Bonus",
		"granted_by":    "demo-seed",
		"reason":        "demo active bonus progress",
		"demo_seed":     true,
	})
	pb := bonus.PlayerBonus{
		ID:                    190,
		UserID:                "u-1",
		BonusType:             "custom",
		Status:                "active",
		GrantedAmountPoints:   20000,
		RemainingAmountPoints: 15000,
		ExpiresAt:             expiresAt,
		GrantedAt:             grantedAt,
		Metadata:              metadata,
	}

	payload := playerBonusResponse(pb, campaignNameFromBonus(pb))

	if payload["unit"] != "PTS" {
		t.Fatalf("expected point unit, got %v", payload["unit"])
	}
	if payload["campaignName"] != "Demo Point-Play Bonus" {
		t.Fatalf("expected demo campaign name, got %+v", payload)
	}
	if payload["remainingPoints"] != int64(15000) {
		t.Fatalf("expected demo remaining points, got %+v", payload)
	}
	for _, retired := range []string{
		"remainingAmountPoints",
		"wageringRequiredPoints",
		"wageringCompletedPoints",
		"wageringProgressPct",
		"progressPct",
	} {
		if _, ok := payload[retired]; ok {
			t.Fatalf("retired demo bonus field %q leaked in %+v", retired, payload)
		}
	}
}

func TestCampaignResponseUsesPointNativeContract(t *testing.T) {
	budget := int64(75000)
	campaign := bonus.Campaign{
		ID:           12,
		Name:         "Summer Points",
		CampaignType: "freebet_grant",
		Status:       "active",
		BudgetPoints: &budget,
		SpentPoints:  25000,
		ClaimCount:   3,
	}

	payload := campaignResponse(campaign)

	if payload["unit"] != "PTS" {
		t.Fatalf("expected point unit, got %v", payload["unit"])
	}
	if payload["budgetPoints"] != budget {
		t.Fatalf("expected budget point alias, got %+v", payload)
	}
	if payload["spentPoints"] != int64(25000) {
		t.Fatalf("expected spent points, got %+v", payload)
	}
	if payload["campaignType"] != "point_grant" {
		t.Fatalf("expected retired campaign type to map to point_grant, got %+v", payload)
	}
	// Points unit-model (2026-07-07): budgetPoints/spentPoints are canonical;
	// the retired spellings are the cents-era point-cents keys.
	for _, retired := range []string{"budgetPointsCents", "spentPointsCents", "rules"} {
		if _, ok := payload[retired]; ok {
			t.Fatalf("retired campaign field %q leaked in %+v", retired, payload)
		}
	}
}

func TestCampaignResponseRedactsLegacyUnsafeCopyWithoutMutatingCampaign(t *testing.T) {
	campaign := bonus.Campaign{
		ID:           13,
		Name:         "Crypto payout campaign",
		Description:  "Cash prize for legacy operators",
		CampaignType: "freebet_grant",
		Status:       "active",
	}

	payload := campaignResponse(campaign)

	if payload["name"] != launchRedactedUserText || payload["description"] != launchRedactedUserText {
		t.Fatalf("expected unsafe campaign display copy redacted, got %+v", payload)
	}
	if campaign.Name != "Crypto payout campaign" || campaign.Description != "Cash prize for legacy operators" {
		t.Fatalf("campaignResponse must not mutate raw campaign, got %+v", campaign)
	}
	if payload["campaignType"] != "point_grant" {
		t.Fatalf("expected retired campaign type to map to point_grant, got %+v", payload)
	}
}

func TestCampaignRuleResponseUsesPointNativeRuleConfig(t *testing.T) {
	// Points unit-model (2026-07-07): the legacy stored config carries the
	// cents-era sportsbook keys; the payload must translate them to the
	// point-native aliases without leaking the retired spellings.
	raw, _ := json.Marshal(map[string]any{
		"max_bonus_cents":              5000,
		"fixed_amount_cents":           1250,
		"max_stake_contribution_cents": 300,
		"min_odds_decimal":             1.5,
		"parlay_multiplier":            2,
		"excluded_sports":              []string{"basketball"},
		"min_amount_cents":             1000,
		"type":                         "freebet",
		"event":                        "deposit",
		"min_deposits":                 2,
		"tier_min":                     "gold",
	})
	rule := bonus.CampaignRule{
		ID:         99,
		CampaignID: 12,
		RuleType:   "reward",
		RuleConfig: raw,
	}

	payload := campaignRuleResponse(rule)
	pointConfig := payload["pointRuleConfig"].(map[string]any)

	if payload["unit"] != "PTS" {
		t.Fatalf("expected point unit, got %v", payload["unit"])
	}
	if payload["ruleType"] != "reward" {
		t.Fatalf("expected rule type reward, got %+v", payload)
	}
	if _, ok := payload["ruleConfig"]; ok {
		t.Fatalf("retired raw ruleConfig leaked in %+v", payload)
	}
	if pointConfig["max_bonus_points"] != float64(5000) {
		t.Fatalf("expected max bonus point alias, got %+v", pointConfig)
	}
	if pointConfig["fixed_amount_points"] != float64(1250) {
		t.Fatalf("expected fixed amount point alias, got %+v", pointConfig)
	}
	if pointConfig["max_play_contribution_points"] != float64(300) {
		t.Fatalf("expected max contribution point alias, got %+v", pointConfig)
	}
	if pointConfig["min_points"] != float64(1000) {
		t.Fatalf("expected min points alias, got %+v", pointConfig)
	}
	if pointConfig["type"] != "point_grant" {
		t.Fatalf("expected reward type point alias, got %+v", pointConfig)
	}
	if pointConfig["event"] != "manual_review" {
		t.Fatalf("expected trigger event point alias, got %+v", pointConfig)
	}
	if pointConfig["min_point_activity_count"] != float64(2) {
		t.Fatalf("expected min point activity alias, got %+v", pointConfig)
	}
	if pointConfig["rank_min"] != "gold" {
		t.Fatalf("expected rank min alias, got %+v", pointConfig)
	}
	for _, retired := range []string{
		"max_bonus_cents",
		"fixed_amount_cents",
		"max_stake_contribution_cents",
		"max_stake_contribution_points",
		"min_odds_decimal",
		"parlay_multiplier",
		"excluded_sports",
		"min_amount_cents",
		"min_deposits",
		"tier_min",
	} {
		if _, ok := pointConfig[retired]; ok {
			t.Fatalf("retired rule config field %q leaked in %+v", retired, pointConfig)
		}
	}
}

func TestCampaignRuleResponseKeepsPreferredPointRuleAlias(t *testing.T) {
	raw, _ := json.Marshal(map[string]any{
		"max_play_contribution_points":  425,
		"max_stake_contribution_points": 300,
	})
	rule := bonus.CampaignRule{
		ID:         100,
		CampaignID: 12,
		RuleType:   "reward",
		RuleConfig: raw,
	}

	payload := campaignRuleResponse(rule)
	pointConfig := payload["pointRuleConfig"].(map[string]any)

	if pointConfig["max_play_contribution_points"] != float64(425) {
		t.Fatalf("expected preferred point-play contribution cap to win, got %+v", pointConfig)
	}
	if _, ok := pointConfig["max_stake_contribution_points"]; ok {
		t.Fatalf("retired point-stake contribution cap leaked in %+v", pointConfig)
	}
}
