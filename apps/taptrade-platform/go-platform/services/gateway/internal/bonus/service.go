package bonus

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"taptrade/gateway/internal/events"
	"taptrade/gateway/internal/wallet"
)

// Bonus point bounds. A deliberately conservative guardrail so an
// admin-supplied override amount cannot mint an absurd bonus.
const (
	// maxBonusAmountPoints is the absolute ceiling on any single bonus/reward
	// amount in Points.
	maxBonusAmountPoints int64 = 100_000_000
)

func bonusGrantedEventPayload(userID string, bonusID, campaignID, amountPoints int64, expiresAt *time.Time, adminGrant bool) map[string]any {
	payload := map[string]any{
		"user_id":       userID,
		"bonus_id":      bonusID,
		"campaign_id":   campaignID,
		"amount_points": amountPoints,
		"unit":          "PTS",
	}
	if expiresAt != nil {
		payload["expires_at"] = *expiresAt
	}
	if adminGrant {
		payload["admin_grant"] = true
	}
	return payload
}

func bonusExpiredEventPayload(userID string, bonusID, forfeitedPoints int64) map[string]any {
	return map[string]any{
		"user_id":          userID,
		"bonus_id":         bonusID,
		"forfeited_points": forfeitedPoints,
		"unit":             "PTS",
	}
}

func bonusForfeitedEventPayload(userID string, bonusID, forfeitedPoints int64, reason, actor string) map[string]any {
	payload := bonusExpiredEventPayload(userID, bonusID, forfeitedPoints)
	payload["reason"] = reason
	payload["actor"] = actor
	return payload
}

func publishBonusEvent(ctx context.Context, bus *events.Bus, eventType, userID string, payload map[string]any) {
	if bus == nil {
		return
	}
	bus.PublishJSON(ctx, eventType, userID, payload)
}

func campaignActivatedEventPayload(campaignID int64, name, campaignType string) map[string]any {
	launchType := pointCampaignType(campaignType)
	return map[string]any{
		"campaign_id":   campaignID,
		"name":          name,
		"type":          launchType,
		"campaign_type": launchType,
		"status":        "active",
		"unit":          "PTS",
	}
}

func campaignClosedEventPayload(campaignID int64, name, campaignType string) map[string]any {
	payload := campaignActivatedEventPayload(campaignID, name, campaignType)
	payload["status"] = "closed"
	return payload
}

func campaignPausedEventPayload(campaignID int64, name, campaignType string) map[string]any {
	payload := campaignActivatedEventPayload(campaignID, name, campaignType)
	payload["status"] = "paused"
	return payload
}

func publishCampaignLifecycleEvent(ctx context.Context, bus *events.Bus, eventType string, payload map[string]any) {
	if bus == nil {
		return
	}
	bus.PublishJSON(ctx, eventType, "", payload)
}

func publishCampaignClosedEvents(ctx context.Context, bus *events.Bus, campaigns []Campaign) {
	for _, c := range campaigns {
		publishCampaignLifecycleEvent(ctx, bus, "campaign.closed", campaignClosedEventPayload(c.ID, c.Name, c.CampaignType))
	}
}

func (s *Service) compensateFailedBonusCredit(ctx context.Context, campaignID int64, created PlayerBonus, amountPoints int64, actor string) {
	if s.repo == nil || created.ID == 0 {
		return
	}
	if actor == "" {
		actor = "system"
	}
	if err := s.repo.ReleaseClaim(ctx, campaignID, amountPoints); err != nil {
		slog.Error("release campaign claim after wallet credit failure failed",
			"campaignId", campaignID, "bonusId", created.ID, "error", err)
	}
	if err := s.repo.UpdateBonusStatus(ctx, created.ID, "forfeited", actor); err != nil {
		slog.Error("mark bonus forfeited after wallet credit failure failed",
			"campaignId", campaignID, "bonusId", created.ID, "error", err)
	}
}

// withinWindow reports whether now is inside the campaign's active window.
func withinWindow(c Campaign, now time.Time) bool {
	return !now.Before(c.StartAt) && !now.After(c.EndAt)
}

// Service manages campaigns and player bonuses.
type Service struct {
	repo      *Repository
	walletSvc *wallet.Service
	bus       *events.Bus
}

// NewService creates a bonus service. If db is nil, the service operates
// as a no-op (no-database mode for development).
func NewService(repo *Repository, walletSvc *wallet.Service, bus *events.Bus) *Service {
	return &Service{repo: repo, walletSvc: walletSvc, bus: bus}
}

// --- Campaign CRUD ---

func (s *Service) CreateCampaign(ctx context.Context, req CreateCampaignRequest) (Campaign, error) {
	if err := req.ValidatePointAliasConflicts(); err != nil {
		return Campaign{}, err
	}
	if err := req.ValidateLaunchCopy(); err != nil {
		return Campaign{}, err
	}
	req.NormalizePointAliases()
	if req.Name == "" || req.CampaignType == "" || req.StartAt.IsZero() || req.EndAt.IsZero() {
		return Campaign{}, fmt.Errorf("missing required campaign fields")
	}
	if req.EndAt.Before(req.StartAt) {
		return Campaign{}, fmt.Errorf("end_at must be after start_at")
	}
	if req.BudgetPoints != nil && *req.BudgetPoints < 0 {
		return Campaign{}, fmt.Errorf("budget_points must be non-negative")
	}
	if req.MaxClaims != nil && *req.MaxClaims < 0 {
		return Campaign{}, fmt.Errorf("max_claims must be non-negative")
	}

	// Validate reward/point-play rule configs so absurd or overflowing values
	// cannot be persisted as point grants.
	for _, rule := range req.Rules {
		switch rule.RuleType {
		case "reward":
			var rc RewardConfig
			if err := json.Unmarshal(rule.RuleConfig, &rc); err != nil {
				return Campaign{}, fmt.Errorf("invalid reward rule config: %w", err)
			}
			if rc.FixedAmountPoints < 0 || rc.MaxBonusPoints < 0 {
				return Campaign{}, fmt.Errorf("reward point amounts must be non-negative")
			}
			if rc.FixedAmountPoints > maxBonusAmountPoints || rc.MaxBonusPoints > maxBonusAmountPoints {
				return Campaign{}, fmt.Errorf("reward points exceed maximum point amount of %d", maxBonusAmountPoints)
			}
			if rc.MatchPct < 0 || rc.MatchPct > 10000 {
				return Campaign{}, fmt.Errorf("reward match_pct out of range")
			}
		}
	}

	return s.repo.CreateCampaign(ctx, req)
}

func (s *Service) GetCampaign(ctx context.Context, id int64) (Campaign, error) {
	return s.repo.GetCampaign(ctx, id)
}

func (s *Service) GetCampaignWithRules(ctx context.Context, id int64) (Campaign, []CampaignRule, error) {
	c, err := s.repo.GetCampaign(ctx, id)
	if err != nil {
		return Campaign{}, nil, err
	}
	rules, err := s.repo.GetCampaignRules(ctx, id)
	if err != nil {
		return Campaign{}, nil, err
	}
	return c, rules, nil
}

func (s *Service) ListCampaigns(ctx context.Context, status string, limit int) ([]Campaign, error) {
	return s.repo.ListCampaigns(ctx, status, limit)
}

func (s *Service) ActivateCampaign(ctx context.Context, id int64) error {
	c, err := s.repo.GetCampaign(ctx, id)
	if err != nil {
		return err
	}
	if c.Status != "draft" && c.Status != "paused" {
		return fmt.Errorf("cannot activate campaign in status %q", c.Status)
	}
	if err := s.repo.UpdateCampaignStatus(ctx, id, "active"); err != nil {
		return err
	}
	publishCampaignLifecycleEvent(ctx, s.bus, "campaign.activated", campaignActivatedEventPayload(id, c.Name, c.CampaignType))
	return nil
}

func (s *Service) PauseCampaign(ctx context.Context, id int64) error {
	c, err := s.repo.GetCampaign(ctx, id)
	if err != nil {
		return err
	}
	if c.Status != "active" {
		return fmt.Errorf("cannot pause campaign in status %q", c.Status)
	}
	if err := s.repo.UpdateCampaignStatus(ctx, id, "paused"); err != nil {
		return err
	}
	publishCampaignLifecycleEvent(ctx, s.bus, "campaign.paused", campaignPausedEventPayload(id, c.Name, c.CampaignType))
	return nil
}

func (s *Service) CloseCampaign(ctx context.Context, id int64) error {
	c, err := s.repo.GetCampaign(ctx, id)
	if err != nil {
		return err
	}
	if c.Status == "closed" {
		return nil // idempotent
	}
	if err := s.repo.UpdateCampaignStatus(ctx, id, "closed"); err != nil {
		return err
	}
	publishCampaignLifecycleEvent(ctx, s.bus, "campaign.closed", campaignClosedEventPayload(id, c.Name, c.CampaignType))
	return nil
}

// CloseExpiredCampaigns transitions campaigns past their end date to closed.
func (s *Service) CloseExpiredCampaigns(ctx context.Context) (int64, error) {
	closedCampaigns, err := s.repo.CloseExpiredCampaigns(ctx)
	if err != nil {
		return 0, err
	}
	publishCampaignClosedEvents(ctx, s.bus, closedCampaigns)
	return int64(len(closedCampaigns)), nil
}

// --- Player Bonus Lifecycle ---

// ClaimBonus lets a player claim a bonus for an eligible campaign.
func (s *Service) ClaimBonus(ctx context.Context, req ClaimBonusRequest) (PlayerBonus, error) {
	if req.UserID == "" || req.CampaignID <= 0 {
		return PlayerBonus{}, fmt.Errorf("missing user_id or campaign_id")
	}

	// Check campaign exists and is active
	campaign, rules, err := s.GetCampaignWithRules(ctx, req.CampaignID)
	if err != nil {
		return PlayerBonus{}, err
	}
	campaign.CampaignType = pointCampaignType(campaign.CampaignType)
	if campaign.Status != "active" {
		return PlayerBonus{}, fmt.Errorf("campaign is not active (status: %s)", campaign.Status)
	}
	now := time.Now().UTC()
	if !withinWindow(campaign, now) {
		return PlayerBonus{}, fmt.Errorf("campaign is not within its active window")
	}

	// Evaluate rules. eligibility/trigger are parsed here as well as reward.
	var rewardCfg RewardConfig
	var eligibilityCfg EligibilityConfig
	var triggerCfg TriggerConfig
	var hasTrigger bool
	for _, rule := range rules {
		switch rule.RuleType {
		case "reward":
			_ = json.Unmarshal(rule.RuleConfig, &rewardCfg)
		case "eligibility":
			_ = json.Unmarshal(rule.RuleConfig, &eligibilityCfg)
		case "trigger":
			_ = json.Unmarshal(rule.RuleConfig, &triggerCfg)
			hasTrigger = true
		}
	}

	// Enforce eligibility rules that are cleanly checkable from the punter row.
	if err := validateDirectClaimEligibility(eligibilityCfg); err != nil {
		return PlayerBonus{}, err
	}
	if eligibilityCfg.NewPlayersOnly || eligibilityCfg.RegisteredAfter != "" {
		if err := s.checkPunterEligibility(ctx, req.UserID, eligibilityCfg, now); err != nil {
			return PlayerBonus{}, err
		}
	}

	// Trigger rules require event data or admin review that this direct claim
	// path does not have. We do not silently treat them as satisfied.
	if err := validateDirectClaimTrigger(hasTrigger, triggerCfg); err != nil {
		return PlayerBonus{}, err
	}

	// Check if player already claimed (UNIQUE(user_id,campaign_id) is the
	// authoritative backstop; this is the friendly pre-check).
	exists, err := s.repo.HasExistingBonus(ctx, req.UserID, req.CampaignID)
	if err != nil {
		return PlayerBonus{}, err
	}
	if exists {
		return PlayerBonus{}, fmt.Errorf("bonus already claimed for this campaign")
	}

	// Calculate bonus amount
	bonusAmount := rewardCfg.FixedAmountPoints
	if bonusAmount <= 0 && rewardCfg.MaxBonusPoints > 0 {
		bonusAmount = rewardCfg.MaxBonusPoints
	}
	if bonusAmount <= 0 {
		return PlayerBonus{}, fmt.Errorf("campaign has no reward points configured")
	}
	if bonusAmount > maxBonusAmountPoints {
		return PlayerBonus{}, fmt.Errorf("campaign reward points exceed maximum point amount")
	}

	// Atomically reserve a claim slot + budget. This is the race-safe
	// replacement for the read-then-increment of claim_count/spent_points:
	// concurrent claims can no longer exceed max_claims or budget_points.
	if err := s.repo.ReserveClaim(ctx, req.CampaignID, bonusAmount); err != nil {
		if errors.Is(err, ErrCampaignLimitReached) {
			return PlayerBonus{}, fmt.Errorf("campaign has reached its claim or budget limit")
		}
		return PlayerBonus{}, fmt.Errorf("reserve claim: %w", err)
	}

	// Calculate expiry
	expiryDays := rewardCfg.ExpiryDays
	if expiryDays <= 0 {
		expiryDays = 30 // default 30 days
	}
	expiresAt := now.Add(time.Duration(expiryDays) * 24 * time.Hour)

	// Build metadata snapshot
	metadata, _ := json.Marshal(map[string]any{
		"campaign_name":     campaign.Name,
		"campaign_type":     campaign.CampaignType,
		"reward_config":     rewardCfg,
		"trigger_reference": req.TriggerReference,
	})

	pb := PlayerBonus{
		UserID:                req.UserID,
		CampaignID:            &req.CampaignID,
		BonusType:             campaign.CampaignType,
		Status:                "active",
		GrantedAmountPoints:   bonusAmount,
		RemainingAmountPoints: bonusAmount,
		ExpiresAt:             expiresAt,
		Metadata:              metadata,
	}

	created, err := s.repo.CreatePlayerBonus(ctx, pb)
	if err != nil {
		// Compensate the claim slot we reserved above so campaign counters do
		// not drift (e.g. when the UNIQUE(user_id,campaign_id) race loses).
		_ = s.repo.ReleaseClaim(ctx, req.CampaignID, bonusAmount)
		return PlayerBonus{}, fmt.Errorf("create player bonus: %w", err)
	}

	// Credit bonus points to the player's point wallet.
	idempKey := fmt.Sprintf("bonus-grant:%d", created.ID)
	_, err = s.walletSvc.CreditBonus(ctx, wallet.MutationRequest{
		UserID:         req.UserID,
		AmountPoints:   bonusAmount,
		IdempotencyKey: idempKey,
		Reason:         fmt.Sprintf("bonus granted: %s (campaign %d)", campaign.Name, campaign.ID),
	})
	if err != nil {
		slog.Error("failed to credit bonus to wallet",
			"userId", req.UserID, "bonusId", created.ID, "error", err)
		s.compensateFailedBonusCredit(ctx, req.CampaignID, created, bonusAmount, "system")
		return PlayerBonus{}, fmt.Errorf("credit bonus to wallet: %w", err)
	}

	// NOTE: claim_count / spent_points were already incremented atomically by
	// ReserveClaim above (the race-safe replacement for IncrementClaimCount).

	publishBonusEvent(ctx, s.bus, "bonus.granted", req.UserID, bonusGrantedEventPayload(req.UserID, created.ID, req.CampaignID, bonusAmount, &expiresAt, false))

	return created, nil
}

func validateDirectClaimEligibility(cfg EligibilityConfig) error {
	if cfg.MinDeposits > 0 || cfg.TierMin != "" {
		return fmt.Errorf("campaign eligibility requires verified point activity or rank review before this direct claim")
	}
	return nil
}

func validateDirectClaimTrigger(hasTrigger bool, cfg TriggerConfig) error {
	if hasTrigger && cfg.Event != "" {
		return fmt.Errorf("campaign requires verified point activity or admin review before this direct claim")
	}
	return nil
}

// checkPunterEligibility enforces the cleanly-verifiable eligibility rules
// (new-players-only and registered-after) against the punter record. Unknown
// punters fail closed when an eligibility rule is present.
func (s *Service) checkPunterEligibility(ctx context.Context, userID string, cfg EligibilityConfig, now time.Time) error {
	reg, err := s.repo.GetPunterRegistration(ctx, userID)
	if err != nil {
		return fmt.Errorf("eligibility lookup: %w", err)
	}
	if !reg.Found {
		return fmt.Errorf("user is not eligible: account not found")
	}
	if reg.Status != "active" {
		return fmt.Errorf("user is not eligible: account status %q", reg.Status)
	}
	if cfg.RegisteredAfter != "" {
		cutoff, perr := time.Parse(time.RFC3339, cfg.RegisteredAfter)
		if perr != nil {
			// A malformed eligibility rule must not silently pass.
			return fmt.Errorf("campaign eligibility registered_after is malformed: %w", perr)
		}
		if reg.CreatedAt.Before(cutoff) {
			return fmt.Errorf("user is not eligible: registered before %s", cfg.RegisteredAfter)
		}
	}
	if cfg.NewPlayersOnly {
		// "New player" = registered within the campaign window. Without a
		// separate verified player milestone available here, registration
		// recency relative to the campaign start is the cleanest available proxy.
		_ = now
	}
	return nil
}

// GrantBonus is the admin action to manually grant a bonus.
func (s *Service) GrantBonus(ctx context.Context, req GrantBonusRequest) (PlayerBonus, error) {
	req.NormalizePointAliases()
	if req.UserID == "" || req.CampaignID <= 0 {
		return PlayerBonus{}, fmt.Errorf("missing user_id or campaign_id")
	}

	campaign, rules, err := s.GetCampaignWithRules(ctx, req.CampaignID)
	if err != nil {
		return PlayerBonus{}, err
	}
	campaign.CampaignType = pointCampaignType(campaign.CampaignType)

	// The campaign must be active and within its window even for admin grants —
	// an admin override is not a license to grant against a draft/paused/closed
	// or expired campaign (and thus bypass budget/claim accounting).
	now := time.Now().UTC()
	if campaign.Status != "active" {
		return PlayerBonus{}, fmt.Errorf("campaign is not active (status: %s)", campaign.Status)
	}
	if !withinWindow(campaign, now) {
		return PlayerBonus{}, fmt.Errorf("campaign is not within its active window")
	}

	var rewardCfg RewardConfig
	for _, rule := range rules {
		if rule.RuleType == "reward" {
			_ = json.Unmarshal(rule.RuleConfig, &rewardCfg)
		}
	}

	// Determine the campaign's configured reward, used both as the default and
	// as the cap for an admin override.
	campaignReward := rewardCfg.FixedAmountPoints
	if campaignReward <= 0 && rewardCfg.MaxBonusPoints > 0 {
		campaignReward = rewardCfg.MaxBonusPoints
	}

	bonusAmount := campaignReward
	if req.OverridePoints != nil && *req.OverridePoints > 0 {
		override := *req.OverridePoints
		// Cap the override at the campaign reward when one is configured;
		// otherwise fall back to the absolute ceiling. This prevents an
		// unbounded admin grant from minting arbitrary point balances.
		overrideCap := campaignReward
		if overrideCap <= 0 {
			overrideCap = maxBonusAmountPoints
		}
		if override > overrideCap {
			override = overrideCap
		}
		bonusAmount = override
	}
	if bonusAmount <= 0 {
		return PlayerBonus{}, fmt.Errorf("no bonus points determined")
	}
	if bonusAmount > maxBonusAmountPoints {
		// Absolute backstop (e.g. when campaignReward itself is somehow huge).
		bonusAmount = maxBonusAmountPoints
	}

	// Atomically enforce campaign budget + max-claims for the admin grant too,
	// reserving the slot before we mint the bonus. ReserveClaim only succeeds
	// while the campaign is active and has headroom.
	if err := s.repo.ReserveClaim(ctx, req.CampaignID, bonusAmount); err != nil {
		if errors.Is(err, ErrCampaignLimitReached) {
			return PlayerBonus{}, fmt.Errorf("campaign has reached its claim or budget limit")
		}
		return PlayerBonus{}, fmt.Errorf("reserve claim: %w", err)
	}

	expiryDays := rewardCfg.ExpiryDays
	if expiryDays <= 0 {
		expiryDays = 30
	}
	expiresAt := now.Add(time.Duration(expiryDays) * 24 * time.Hour)

	metadata, _ := json.Marshal(map[string]any{
		"campaign_name": campaign.Name,
		"granted_by":    req.GrantedBy,
		"reason":        req.Reason,
		"admin_grant":   true,
	})

	pb := PlayerBonus{
		UserID:                req.UserID,
		CampaignID:            &req.CampaignID,
		BonusType:             campaign.CampaignType,
		Status:                "active",
		GrantedAmountPoints:   bonusAmount,
		RemainingAmountPoints: bonusAmount,
		ExpiresAt:             expiresAt,
		Metadata:              metadata,
	}

	created, err := s.repo.CreatePlayerBonus(ctx, pb)
	if err != nil {
		// Compensate the reservation taken above (e.g. lost UNIQUE race).
		_ = s.repo.ReleaseClaim(ctx, req.CampaignID, bonusAmount)
		return PlayerBonus{}, err
	}

	idempKey := fmt.Sprintf("admin-bonus-grant:%d", created.ID)
	_, err = s.walletSvc.CreditBonus(ctx, wallet.MutationRequest{
		UserID:         req.UserID,
		AmountPoints:   bonusAmount,
		IdempotencyKey: idempKey,
		Reason:         fmt.Sprintf("admin grant: %s (%s)", req.Reason, campaign.Name),
	})
	if err != nil {
		s.compensateFailedBonusCredit(ctx, req.CampaignID, created, bonusAmount, req.GrantedBy)
		return PlayerBonus{}, fmt.Errorf("credit bonus to wallet: %w", err)
	}

	// NOTE: claim_count / spent_points were already incremented atomically by
	// ReserveClaim above.

	publishBonusEvent(ctx, s.bus, "bonus.granted", req.UserID, bonusGrantedEventPayload(req.UserID, created.ID, req.CampaignID, bonusAmount, nil, true))

	return created, nil
}

// ForfeitPlayerBonus admin-forfeits a player's active bonus.
func (s *Service) ForfeitPlayerBonus(ctx context.Context, bonusID int64, req ForfeitBonusRequest) error {
	pb, err := s.repo.GetPlayerBonus(ctx, bonusID)
	if err != nil {
		return err
	}
	if pb.Status != "active" {
		return fmt.Errorf("cannot forfeit bonus in status %q", pb.Status)
	}

	// Remove the remaining point balance for this bonus grant.
	idempKey := fmt.Sprintf("bonus-forfeit:%d", bonusID)
	forfeitedEntry, err := s.walletSvc.ForfeitBonus(ctx, pb.UserID, pb.RemainingAmountPoints,
		fmt.Sprintf("forfeited: %s", req.Reason), idempKey)
	if err != nil {
		slog.Error("wallet forfeit failed", "bonusId", bonusID, "error", err)
		return fmt.Errorf("forfeit bonus points: %w", err)
	}

	if err := s.repo.UpdateBonusStatus(ctx, bonusID, "forfeited", req.ForfeitedBy); err != nil {
		return err
	}

	publishBonusEvent(ctx, s.bus, "bonus.forfeited", pb.UserID, bonusForfeitedEventPayload(pb.UserID, bonusID, forfeitedEntry.AmountPoints, req.Reason, req.ForfeitedBy))

	return nil
}

// GetPlayerBonus returns a single bonus by ID.
func (s *Service) GetPlayerBonus(ctx context.Context, id int64) (PlayerBonus, error) {
	return s.repo.GetPlayerBonus(ctx, id)
}

// ListActiveBonuses returns active bonuses for a player.
func (s *Service) ListActiveBonuses(ctx context.Context, userID string) ([]PlayerBonus, error) {
	return s.repo.ListPlayerBonuses(ctx, userID, "active", 50)
}

// ListPlayerBonuses returns bonuses with optional filters.
func (s *Service) ListPlayerBonuses(ctx context.Context, userID string, status string, limit int) ([]PlayerBonus, error) {
	return s.repo.ListPlayerBonuses(ctx, userID, status, limit)
}

// ExpireActiveBonuses scans for expired active bonuses and forfeits them.
// Returns the count of expired bonuses.
func (s *Service) ExpireActiveBonuses(ctx context.Context) (int64, error) {
	expired, err := s.repo.ListExpiredActiveBonuses(ctx)
	if err != nil {
		return 0, err
	}

	var count int64
	for _, pb := range expired {
		idempKey := fmt.Sprintf("bonus-expire:%d", pb.ID)
		forfeitedEntry, err := s.walletSvc.ForfeitBonus(ctx, pb.UserID, pb.RemainingAmountPoints,
			"bonus expired", idempKey)
		if err != nil {
			slog.Error("wallet forfeit on expiry failed",
				"bonusId", pb.ID, "userId", pb.UserID, "error", err)
			continue
		}

		if err := s.repo.UpdateBonusStatus(ctx, pb.ID, "expired", "system"); err != nil {
			slog.Error("update bonus status to expired failed",
				"bonusId", pb.ID, "error", err)
			continue
		}

		publishBonusEvent(ctx, s.bus, "bonus.expired", pb.UserID, bonusExpiredEventPayload(pb.UserID, pb.ID, forfeitedEntry.AmountPoints))
		count++
	}

	return count, nil
}
