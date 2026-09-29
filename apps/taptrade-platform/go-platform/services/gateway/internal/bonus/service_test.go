package bonus

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"taptrade/gateway/internal/events"
	"testing"
	"time"
)

func TestBonusGrantedEventPayloadUsesPointNativeAmount(t *testing.T) {
	expiresAt := time.Date(2026, 6, 27, 12, 0, 0, 0, time.UTC)
	payload := bonusGrantedEventPayload("user-1", 7, 11, 5000, &expiresAt, false)

	assertPayloadHasNumber(t, payload, "amount_points", 5000)
	if payload["unit"] != "PTS" {
		t.Fatalf("expected PTS unit, got %#v", payload["unit"])
	}
	if payload["expires_at"] != expiresAt {
		t.Fatalf("expected expires_at to be preserved, got %#v", payload["expires_at"])
	}
}

func TestAdminBonusGrantedEventPayloadUsesPointNativeAmount(t *testing.T) {
	payload := bonusGrantedEventPayload("user-1", 7, 11, 5000, nil, true)

	assertPayloadHasNumber(t, payload, "amount_points", 5000)
	if payload["admin_grant"] != true {
		t.Fatalf("expected admin_grant marker, got %#v", payload["admin_grant"])
	}
	if _, ok := payload["expires_at"]; ok {
		t.Fatal("did not expect expires_at on admin grant payload")
	}
}

func TestBonusExpiredEventPayloadUsesPointNativeForfeitAmount(t *testing.T) {
	payload := bonusExpiredEventPayload("user-1", 7, 3200)

	assertPayloadHasNumber(t, payload, "forfeited_points", 3200)
	if payload["unit"] != "PTS" {
		t.Fatalf("expected PTS unit, got %#v", payload["unit"])
	}
	assertPayloadMissing(t, payload, "forfeited_amount")
}

func TestBonusForfeitedEventPayloadUsesPointNativeForfeitAmountAndAuditMetadata(t *testing.T) {
	payload := bonusForfeitedEventPayload("user-1", 7, 3200, "manual review", "admin-1")

	assertPayloadHasNumber(t, payload, "forfeited_points", 3200)
	if payload["unit"] != "PTS" {
		t.Fatalf("expected PTS unit, got %#v", payload["unit"])
	}
	if payload["reason"] != "manual review" {
		t.Fatalf("expected review reason, got %#v", payload["reason"])
	}
	if payload["actor"] != "admin-1" {
		t.Fatalf("expected admin actor, got %#v", payload["actor"])
	}
	assertPayloadMissing(t, payload, "forfeited_amount")
	assertPayloadMissing(t, payload, "amount_points")
}

func TestPublishBonusEventUsesPointNativePayloadAndUserID(t *testing.T) {
	bus := events.NewBus()
	var gotEvent events.Event
	bus.Subscribe("bonus.granted", func(ctx context.Context, event events.Event) error {
		gotEvent = event
		return nil
	})

	publishBonusEvent(
		context.Background(),
		bus,
		"bonus.granted",
		"user-1",
		bonusGrantedEventPayload("user-1", 7, 11, 5000, nil, true),
	)

	if gotEvent.Type != "bonus.granted" {
		t.Fatalf("expected bonus.granted event, got %#v", gotEvent.Type)
	}
	if gotEvent.UserID != "user-1" {
		t.Fatalf("expected event user id, got %#v", gotEvent.UserID)
	}
	var payload map[string]any
	if err := json.Unmarshal(gotEvent.Payload, &payload); err != nil {
		t.Fatalf("unmarshal bonus payload: %v", err)
	}
	if payload["unit"] != "PTS" {
		t.Fatalf("expected PTS unit, got %#v", payload)
	}
	if payload["amount_points"] != float64(5000) {
		t.Fatalf("expected point amount, got %#v", payload)
	}
}

func TestPublishBonusEventAllowsNilBus(t *testing.T) {
	publishBonusEvent(
		context.Background(),
		nil,
		"bonus.granted",
		"user-1",
		bonusGrantedEventPayload("user-1", 7, 11, 5000, nil, true),
	)
}

func TestForfeitPlayerBonusFailsClosedBeforeStatusAndEventOnWalletError(t *testing.T) {
	source, err := os.ReadFile("service.go")
	if err != nil {
		t.Fatalf("read service source: %v", err)
	}
	text := string(source)
	walletErr := strings.Index(text, `return fmt.Errorf("forfeit bonus points: %w", err)`)
	statusUpdate := strings.Index(text, `UpdateBonusStatus(ctx, bonusID, "forfeited"`)
	eventPublish := strings.Index(text, `publishBonusEvent(ctx, s.bus, "bonus.forfeited"`)
	if walletErr < 0 {
		t.Fatal("expected manual forfeit to return a point-native wallet error")
	}
	if statusUpdate < 0 || eventPublish < 0 {
		t.Fatal("expected manual forfeit status update and event publish paths")
	}
	if !(walletErr < statusUpdate && statusUpdate < eventPublish) {
		t.Fatalf("expected wallet error return before status/event updates, got walletErr=%d status=%d event=%d", walletErr, statusUpdate, eventPublish)
	}
}

func TestBonusForfeitEventsUseActualWalletForfeitedAmount(t *testing.T) {
	source, err := os.ReadFile("service.go")
	if err != nil {
		t.Fatalf("read service source: %v", err)
	}
	text := string(source)
	manualPublish := `bonusForfeitedEventPayload(pb.UserID, bonusID, forfeitedEntry.AmountPoints, req.Reason, req.ForfeitedBy)`
	expiryPublish := `bonusExpiredEventPayload(pb.UserID, pb.ID, forfeitedEntry.AmountPoints)`
	if !strings.Contains(text, manualPublish) {
		t.Fatalf("manual forfeit event should use actual wallet-forfeited amount")
	}
	if !strings.Contains(text, expiryPublish) {
		t.Fatalf("expiry event should use actual wallet-forfeited amount")
	}
	for _, retired := range []string{
		`bonusForfeitedEventPayload(pb.UserID, bonusID, pb.RemainingAmountPoints`,
		`bonusExpiredEventPayload(pb.UserID, pb.ID, pb.RemainingAmountPoints`,
	} {
		if strings.Contains(text, retired) {
			t.Fatalf("forfeit event should not publish requested remaining amount: %s", retired)
		}
	}
}

func TestBonusCreditFailureCompensatesClaimAndBonusState(t *testing.T) {
	source, err := os.ReadFile("service.go")
	if err != nil {
		t.Fatalf("read service source: %v", err)
	}
	text := string(source)
	directComp := `s.compensateFailedBonusCredit(ctx, req.CampaignID, created, bonusAmount, "system")`
	adminComp := `s.compensateFailedBonusCredit(ctx, req.CampaignID, created, bonusAmount, req.GrantedBy)`
	for _, want := range []string{
		directComp,
		adminComp,
		`s.repo.ReleaseClaim(ctx, campaignID, amountPoints)`,
		`s.repo.UpdateBonusStatus(ctx, created.ID, "forfeited", actor)`,
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("expected bonus credit failure compensation path to contain %q", want)
		}
	}
	for _, comp := range []string{directComp, adminComp} {
		compIdx := strings.Index(text, comp)
		if compIdx < 0 {
			t.Fatalf("expected compensation call %q", comp)
		}
		returnIdx := strings.Index(text[compIdx:], `return PlayerBonus{}, fmt.Errorf("credit bonus to wallet: %w", err)`)
		if returnIdx < 0 {
			t.Fatalf("expected wallet credit error return after %q", comp)
		}
	}
}

func TestCampaignActivatedEventPayloadMapsRetiredPromoType(t *testing.T) {
	for _, tc := range []struct {
		name string
		in   string
		want string
	}{
		{name: "freebet grant", in: "freebet_grant", want: "point_grant"},
		{name: "freebet", in: "freebet", want: "point_grant"},
		{name: "cash", in: "cash", want: "point_grant"},
		{name: "odds boost", in: "odds_boost", want: "point_grant"},
		{name: "deposit match", in: "deposit_match", want: "point_match"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			payload := campaignActivatedEventPayload(17, "Status Boost", tc.in)

			if payload["type"] != tc.want {
				t.Fatalf("expected mapped type %q, got %#v", tc.want, payload["type"])
			}
			if payload["campaign_type"] != tc.want {
				t.Fatalf("expected mapped campaign_type %q, got %#v", tc.want, payload["campaign_type"])
			}
			if payload["status"] != "active" {
				t.Fatalf("expected active status, got %#v", payload["status"])
			}
			if payload["unit"] != "PTS" {
				t.Fatalf("expected PTS unit, got %#v", payload["unit"])
			}
			raw, err := json.Marshal(payload)
			if err != nil {
				t.Fatalf("marshal activated campaign payload: %v", err)
			}
			for _, retired := range []string{"deposit_match", "freebet", "cash", "amount_points"} {
				if strings.Contains(string(raw), retired) {
					t.Fatalf("activated campaign payload leaked retired value %q in %s", retired, raw)
				}
			}
		})
	}
}

func TestCampaignClosedEventPayloadUsesPointNativeLifecycleContract(t *testing.T) {
	payload := campaignClosedEventPayload(17, "Status Boost", "deposit_match")

	if payload["campaign_id"] != int64(17) {
		t.Fatalf("expected campaign id, got %#v", payload["campaign_id"])
	}
	if payload["name"] != "Status Boost" {
		t.Fatalf("expected campaign name, got %#v", payload["name"])
	}
	if payload["type"] != "point_match" || payload["campaign_type"] != "point_match" {
		t.Fatalf("expected point-native campaign type aliases, got %#v", payload)
	}
	if payload["status"] != "closed" {
		t.Fatalf("expected closed status, got %#v", payload["status"])
	}
	if payload["unit"] != "PTS" {
		t.Fatalf("expected PTS unit, got %#v", payload["unit"])
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal closed campaign payload: %v", err)
	}
	for _, retired := range []string{"deposit_match", "freebet", "cash", "amount_points"} {
		if strings.Contains(string(raw), retired) {
			t.Fatalf("closed campaign payload leaked retired value %q in %s", retired, raw)
		}
	}
}

func TestCampaignPausedEventPayloadUsesPointNativeLifecycleContract(t *testing.T) {
	payload := campaignPausedEventPayload(17, "Status Boost", "deposit_match")

	if payload["campaign_id"] != int64(17) {
		t.Fatalf("expected campaign id, got %#v", payload["campaign_id"])
	}
	if payload["name"] != "Status Boost" {
		t.Fatalf("expected campaign name, got %#v", payload["name"])
	}
	if payload["type"] != "point_match" || payload["campaign_type"] != "point_match" {
		t.Fatalf("expected point-native campaign type aliases, got %#v", payload)
	}
	if payload["status"] != "paused" {
		t.Fatalf("expected paused status, got %#v", payload["status"])
	}
	if payload["unit"] != "PTS" {
		t.Fatalf("expected PTS unit, got %#v", payload["unit"])
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal paused campaign payload: %v", err)
	}
	for _, retired := range []string{"deposit_match", "freebet", "cash", "amount_points"} {
		if strings.Contains(string(raw), retired) {
			t.Fatalf("paused campaign payload leaked retired value %q in %s", retired, raw)
		}
	}
}

func TestPublishCampaignClosedEventsUsesPointNativePayload(t *testing.T) {
	bus := events.NewBus()
	var payloads []map[string]any
	bus.Subscribe("campaign.closed", func(ctx context.Context, event events.Event) error {
		var payload map[string]any
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			t.Fatalf("unmarshal event payload: %v", err)
		}
		payloads = append(payloads, payload)
		return nil
	})

	publishCampaignClosedEvents(context.Background(), bus, []Campaign{
		{ID: 17, Name: "Status Boost", CampaignType: "deposit_match"},
		{ID: 18, Name: "Daily Boost", CampaignType: "freebet_grant"},
	})

	if len(payloads) != 2 {
		t.Fatalf("expected two campaign.closed payloads, got %d", len(payloads))
	}
	if payloads[0]["type"] != "point_match" || payloads[0]["campaign_type"] != "point_match" {
		t.Fatalf("expected first payload to map deposit_match to point_match, got %#v", payloads[0])
	}
	if payloads[1]["type"] != "point_grant" || payloads[1]["campaign_type"] != "point_grant" {
		t.Fatalf("expected second payload to map freebet_grant to point_grant, got %#v", payloads[1])
	}
	for _, payload := range payloads {
		if payload["status"] != "closed" {
			t.Fatalf("expected closed status, got %#v", payload)
		}
		if payload["unit"] != "PTS" {
			t.Fatalf("expected PTS unit, got %#v", payload)
		}
		raw, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("marshal closed campaign payload: %v", err)
		}
		for _, retired := range []string{"deposit_match", "freebet", "cash", "amount_points"} {
			if strings.Contains(string(raw), retired) {
				t.Fatalf("expired campaign payload leaked retired value %q in %s", retired, raw)
			}
		}
	}
}

func TestPublishCampaignClosedEventsAllowsNilBus(t *testing.T) {
	publishCampaignClosedEvents(context.Background(), nil, []Campaign{
		{ID: 17, Name: "Status Boost", CampaignType: "deposit_match"},
	})
}

func TestPublishCampaignLifecycleEventUsesPointNativePayload(t *testing.T) {
	bus := events.NewBus()
	var payload map[string]any
	bus.Subscribe("campaign.activated", func(ctx context.Context, event events.Event) error {
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			t.Fatalf("unmarshal lifecycle payload: %v", err)
		}
		return nil
	})

	publishCampaignLifecycleEvent(
		context.Background(),
		bus,
		"campaign.activated",
		campaignActivatedEventPayload(17, "Status Boost", "deposit_match"),
	)

	if payload == nil {
		t.Fatal("expected lifecycle payload to be published")
	}
	if payload["type"] != "point_match" || payload["campaign_type"] != "point_match" {
		t.Fatalf("expected mapped point-native campaign type aliases, got %#v", payload)
	}
	if payload["status"] != "active" {
		t.Fatalf("expected active status, got %#v", payload)
	}
	if payload["unit"] != "PTS" {
		t.Fatalf("expected PTS unit, got %#v", payload)
	}
}

func TestPublishCampaignLifecycleEventAllowsNilBus(t *testing.T) {
	publishCampaignLifecycleEvent(
		context.Background(),
		nil,
		"campaign.activated",
		campaignActivatedEventPayload(17, "Status Boost", "deposit_match"),
	)
}

func TestValidateDirectClaimEligibilityRejectsUnverifiableActivityOrRank(t *testing.T) {
	for _, tc := range []struct {
		name string
		cfg  EligibilityConfig
	}{
		{name: "point activity", cfg: EligibilityConfig{MinDeposits: 1}},
		{name: "rank", cfg: EligibilityConfig{TierMin: "gold"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := validateDirectClaimEligibility(tc.cfg)
			if err == nil {
				t.Fatal("expected unverifiable direct-claim eligibility to be rejected")
			}
			if !strings.Contains(err.Error(), "verified point activity or rank review") {
				t.Fatalf("expected point-native eligibility error, got %v", err)
			}
		})
	}
}

func TestValidateDirectClaimEligibilityAllowsCheckableEligibility(t *testing.T) {
	cfg := EligibilityConfig{
		NewPlayersOnly:  true,
		RegisteredAfter: "2026-06-27T00:00:00Z",
	}
	if err := validateDirectClaimEligibility(cfg); err != nil {
		t.Fatalf("expected checkable direct-claim eligibility to pass, got %v", err)
	}
}

func TestValidateDirectClaimTriggerRejectsManualOrActivityTriggers(t *testing.T) {
	for _, event := range []string{"manual", "prediction_order", "point_grant"} {
		t.Run(event, func(t *testing.T) {
			err := validateDirectClaimTrigger(true, TriggerConfig{Event: event})
			if err == nil {
				t.Fatal("expected direct claim trigger to be rejected")
			}
			if !strings.Contains(err.Error(), "verified point activity or admin review") {
				t.Fatalf("expected point-native trigger review error, got %v", err)
			}
		})
	}
}

func TestValidateDirectClaimTriggerAllowsNoExplicitTrigger(t *testing.T) {
	if err := validateDirectClaimTrigger(false, TriggerConfig{}); err != nil {
		t.Fatalf("expected missing trigger rule to pass, got %v", err)
	}
	if err := validateDirectClaimTrigger(true, TriggerConfig{}); err != nil {
		t.Fatalf("expected empty trigger event to pass, got %v", err)
	}
}

func assertPayloadHasNumber(t *testing.T, payload map[string]any, key string, want int64) {
	t.Helper()
	got, ok := payload[key].(int64)
	if !ok {
		t.Fatalf("expected %s to be int64, got %#v", key, payload[key])
	}
	if got != want {
		t.Fatalf("expected %s=%d, got %d", key, want, got)
	}
}

func assertPayloadMissing(t *testing.T, payload map[string]any, key string) {
	t.Helper()
	if _, ok := payload[key]; ok {
		t.Fatalf("did not expect retired payload key %q in %#v", key, payload)
	}
}

func mustRuleConfig(t *testing.T, v any) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal rule config: %v", err)
	}
	return b
}

func baseCampaignReq() CreateCampaignRequest {
	return CreateCampaignRequest{
		Name:         "Test",
		CampaignType: "signup_bonus",
		StartAt:      time.Now().UTC(),
		EndAt:        time.Now().UTC().Add(24 * time.Hour),
		CreatedBy:    "tester",
	}
}

// CreateCampaign validation runs before any DB access, so a nil-repo service is
// sufficient to exercise the rejection paths.
func newValidationOnlyService() *Service {
	return NewService(NewRepository(nil), nil, nil)
}

func TestCreateCampaign_RejectsNegativeReward(t *testing.T) {
	svc := newValidationOnlyService()
	req := baseCampaignReq()
	req.Rules = []RuleInput{
		{RuleType: "reward", RuleConfig: mustRuleConfig(t, map[string]any{"fixed_amount_points": -100})},
	}
	_, err := svc.CreateCampaign(context.Background(), req)
	if err == nil {
		t.Fatal("expected rejection of negative reward amount")
	}
	if err.Error() != "reward point amounts must be non-negative" {
		t.Fatalf("expected point-native reward validation message, got %q", err.Error())
	}
}

func TestCreateCampaign_RejectsRewardOverCeiling(t *testing.T) {
	svc := newValidationOnlyService()
	req := baseCampaignReq()
	req.Rules = []RuleInput{
		{RuleType: "reward", RuleConfig: mustRuleConfig(t, map[string]any{"fixed_amount_points": maxBonusAmountPoints + 1})},
	}
	_, err := svc.CreateCampaign(context.Background(), req)
	if err == nil {
		t.Fatal("expected rejection of reward above absolute ceiling")
	}
	if err.Error() != "reward points exceed maximum point amount of 100000000" {
		t.Fatalf("expected point-native reward ceiling message, got %q", err.Error())
	}
}

func TestCreateCampaign_RejectsNegativeBudget(t *testing.T) {
	svc := newValidationOnlyService()
	req := baseCampaignReq()
	neg := int64(-1)
	req.BudgetPoints = &neg
	if _, err := svc.CreateCampaign(context.Background(), req); err == nil {
		t.Fatal("expected rejection of negative budget")
	}
}

func TestCreateCampaign_SingleBudgetFieldAccepted(t *testing.T) {
	// Points unit-model (2026-07-07): the cents-era budget alias is retired.
	// budget_points is the single authoritative field and must clear the
	// request validators (the validation-only service has no DB, so the
	// full create path can't run here).
	req := baseCampaignReq()
	points := int64(2000)
	req.BudgetPoints = &points

	if err := req.ValidatePointAliasConflicts(); err != nil {
		t.Fatalf("single budget field must not conflict, got %v", err)
	}
	if err := req.ValidateLaunchCopy(); err != nil {
		t.Fatalf("single budget field must clear launch-copy checks, got %v", err)
	}
}

func TestCreateCampaign_RejectsConflictingRuleAmountAliasesBeforePersistence(t *testing.T) {
	svc := newValidationOnlyService()
	req := baseCampaignReq()
	req.Rules = []RuleInput{
		{
			RuleType: "reward",
			PointRuleConfig: mustRuleConfig(t, map[string]any{
				"min_points":        100,
				"min_amount_points": 200,
			}),
		},
	}

	_, err := svc.CreateCampaign(context.Background(), req)
	if err == nil {
		t.Fatal("expected rejection of conflicting rule amount aliases")
	}
	if !strings.Contains(err.Error(), "min_amount_points") {
		t.Fatalf("expected point-native rule field, got %v", err)
	}
}

func TestGrantBonus_SingleOverrideFieldNormalizes(t *testing.T) {
	points := int64(2000)
	req := GrantBonusRequest{
		UserID:         "u-1",
		CampaignID:     7,
		OverridePoints: &points,
	}
	req.NormalizePointAliases()
	if req.OverridePoints == nil || *req.OverridePoints != 2000 {
		t.Fatal("override_points must survive normalization unchanged")
	}
}

func TestWithinWindow(t *testing.T) {
	now := time.Now().UTC()
	c := Campaign{StartAt: now.Add(-time.Hour), EndAt: now.Add(time.Hour)}
	if !withinWindow(c, now) {
		t.Fatal("expected now to be within window")
	}
	if withinWindow(c, now.Add(2*time.Hour)) {
		t.Fatal("expected after-end to be outside window")
	}
	if withinWindow(c, now.Add(-2*time.Hour)) {
		t.Fatal("expected before-start to be outside window")
	}
}
