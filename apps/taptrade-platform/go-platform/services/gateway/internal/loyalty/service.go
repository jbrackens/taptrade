package loyalty

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"taptrade/gateway/internal/leaderboards"
	canonicalv1 "taptrade/platform/canonical/v1"
)

var (
	ErrInvalidRequest     = errors.New("invalid loyalty request")
	ErrAccountNotFound    = errors.New("loyalty account not found")
	ErrAdjustmentConflict = errors.New("loyalty adjustment idempotency conflict")
	ErrAccrualConflict    = errors.New("loyalty accrual idempotency conflict")
	ErrReferralConflict   = errors.New("loyalty referral conflict")
	ErrTierNotFound       = errors.New("loyalty tier not found")
	ErrRuleNotFound       = errors.New("loyalty rule not found")
)

type SettlementAccrualRequest struct {
	PlayerID         string
	BetID            string
	SettlementStatus string
	StakePoints      int64
	IdempotencyKey   string
	Reason           string
	SettledAt        time.Time
}

type AdjustmentRequest struct {
	PlayerID       string
	PointsDelta    int64
	IdempotencyKey string
	Reason         string
	CreatedBy      string
	EntrySubtype   string
}

type AccountFilter struct {
	PlayerID string
	TierCode string
	Search   string
}

type ReferralCreateRequest struct {
	ReferrerPlayerID string
	ReferredPlayerID string
}

type TierUpdateRequest struct {
	TierCode            canonicalv1.LoyaltyTierCode
	DisplayName         string
	Rank                int
	MinLifetimePoints   int64
	MinRolling30DPoints int64
	Benefits            map[string]string
	Active              bool
}

type RuleUpdateRequest struct {
	RuleID                  string
	Name                    string
	SourceType              string
	Active                  bool
	Multiplier              float64
	MinQualifiedStakePoints int64
	EligibleBetTypes        []string
	MaxPointsPerEvent       int64
	EffectiveFrom           *time.Time
	EffectiveTo             *time.Time
}

type RuleCreateRequest struct {
	Name                    string
	SourceType              string
	Active                  bool
	Multiplier              float64
	MinQualifiedStakePoints int64
	EligibleBetTypes        []string
	MaxPointsPerEvent       int64
	EffectiveFrom           *time.Time
	EffectiveTo             *time.Time
}

type Service struct {
	mu sync.RWMutex

	accounts              map[string]canonicalv1.LoyaltyAccount
	ledger                map[string][]canonicalv1.LoyaltyLedgerEntry
	accrualByKey          map[string]canonicalv1.LoyaltyLedgerEntry
	adjustByKey           map[string]canonicalv1.LoyaltyLedgerEntry
	referralsByID         map[string]canonicalv1.ReferralReward
	referralByReferred    map[string]string
	referralIDsByReferrer map[string][]string
	tiers                 []canonicalv1.LoyaltyTier
	rules                 []canonicalv1.LoyaltyAccrualRule
	entrySequence         int64
	accountSequence       int64
	referralSequence      int64
	referralBonusPoints   int64
	leaderboards          *leaderboards.Service
	statePath             string
	now                   func() time.Time
}

func NewServiceFromEnv() *Service {
	statePath := os.Getenv("LOYALTY_STATE_FILE")
	if statePath == "" {
		statePath = ".data/loyalty-state.json"
	}
	svc := NewService()
	svc.statePath = statePath
	if err := svc.loadFromDisk(); err != nil {
		slog.Warn("loyalty: failed to load state, starting fresh with seeds", "path", statePath, "error", err)
	} else if len(svc.accounts) > 0 {
		slog.Info("loyalty: restored accounts from snapshot", "count", len(svc.accounts), "path", statePath)
		return svc
	}
	return svc
}

func NewService() *Service {
	now := time.Now().UTC().Truncate(time.Second)
	tiers := defaultTiers()
	rules := []canonicalv1.LoyaltyAccrualRule{
		{
			RuleID:                  "rule:loyalty:default-settlement",
			Name:                    "Default settled bet accrual",
			SourceType:              string(canonicalv1.LoyaltyLedgerSourceBetSettlement),
			Active:                  true,
			Multiplier:              1.0,
			MinQualifiedStakePoints: 100,
		},
	}
	svc := &Service{
		accounts:              map[string]canonicalv1.LoyaltyAccount{},
		ledger:                map[string][]canonicalv1.LoyaltyLedgerEntry{},
		accrualByKey:          map[string]canonicalv1.LoyaltyLedgerEntry{},
		adjustByKey:           map[string]canonicalv1.LoyaltyLedgerEntry{},
		referralsByID:         map[string]canonicalv1.ReferralReward{},
		referralByReferred:    map[string]string{},
		referralIDsByReferrer: map[string][]string{},
		tiers:                 tiers,
		rules:                 rules,
		referralBonusPoints:   250,
		now:                   func() time.Time { return time.Now().UTC() },
	}
	svc.seedAccount("u-1", 5800, 4200, 350, 900, 700, now.Add(-30*24*time.Hour), now.Add(-24*time.Hour), now.Add(-2*time.Hour))
	svc.seedAccount("u-2", 850, 850, 120, 300, 180, now.Add(-14*24*time.Hour), now.Add(-14*24*time.Hour), now.Add(-6*time.Hour))
	svc.seedAccount("u-3", 13250, 9100, 540, 1600, 1100, now.Add(-60*24*time.Hour), now.Add(-7*24*time.Hour), now.Add(-3*time.Hour))
	svc.seedAccount("u-4", 2200, 1800, 180, 600, 400, now.Add(-20*24*time.Hour), now.Add(-10*24*time.Hour), now.Add(-5*time.Hour))
	svc.seedAccount("u-5", 450, 350, 80, 150, 100, now.Add(-7*24*time.Hour), now.Add(-7*24*time.Hour), now.Add(-8*time.Hour))

	// --- Ledger entries ---
	svc.seedLedgerEntry("u-1", canonicalv1.LoyaltyLedgerEntry{
		EntryType:    canonicalv1.LoyaltyLedgerEntryAccrual,
		EntrySubtype: "settled_won",
		SourceType:   canonicalv1.LoyaltyLedgerSourceBetSettlement,
		SourceID:     "bet:seed:1001",
		PointsDelta:  125,
		BalanceAfter: 4200,
		Metadata: map[string]string{
			"betId":       "bet:seed:1001",
			"stakePoints": "12500",
			"reason":      "seeded settled bet loyalty accrual",
		},
		CreatedBy: "system",
		CreatedAt: now.Add(-2 * time.Hour),
	})
	svc.seedLedgerEntry("u-1", canonicalv1.LoyaltyLedgerEntry{
		EntryType:    canonicalv1.LoyaltyLedgerEntryReferralBonus,
		EntrySubtype: "first_qualified_referral",
		SourceType:   canonicalv1.LoyaltyLedgerSourceReferral,
		SourceID:     "ref:seed:3001",
		PointsDelta:  250,
		BalanceAfter: 4450,
		Metadata: map[string]string{
			"referredPlayerId": "u-4",
			"reason":           "seeded referral bonus",
		},
		CreatedBy: "system",
		CreatedAt: now.Add(-4 * time.Hour),
	})
	svc.seedLedgerEntry("u-2", canonicalv1.LoyaltyLedgerEntry{
		EntryType:    canonicalv1.LoyaltyLedgerEntryAccrual,
		EntrySubtype: "settled_lost",
		SourceType:   canonicalv1.LoyaltyLedgerSourceBetSettlement,
		SourceID:     "bet:seed:1002",
		PointsDelta:  50,
		BalanceAfter: 850,
		Metadata: map[string]string{
			"betId":       "bet:seed:1002",
			"stakePoints": "5000",
			"reason":      "seeded settled bet loyalty accrual",
		},
		CreatedBy: "system",
		CreatedAt: now.Add(-6 * time.Hour),
	})
	svc.seedLedgerEntry("u-3", canonicalv1.LoyaltyLedgerEntry{
		EntryType:    canonicalv1.LoyaltyLedgerEntryReferralBonus,
		EntrySubtype: "first_qualified_referral",
		SourceType:   canonicalv1.LoyaltyLedgerSourceReferral,
		SourceID:     "ref:seed:2001",
		PointsDelta:  250,
		BalanceAfter: 9100,
		Metadata: map[string]string{
			"referredPlayerId": "u-5",
			"reason":           "seeded qualified referral bonus",
		},
		CreatedBy: "system",
		CreatedAt: now.Add(-90 * time.Minute),
	})
	svc.seedLedgerEntry("u-4", canonicalv1.LoyaltyLedgerEntry{
		EntryType:    canonicalv1.LoyaltyLedgerEntryAccrual,
		EntrySubtype: "settled_won",
		SourceType:   canonicalv1.LoyaltyLedgerSourceBetSettlement,
		SourceID:     "bet:seed:1004",
		PointsDelta:  75,
		BalanceAfter: 1800,
		Metadata: map[string]string{
			"betId":       "bet:seed:1004",
			"stakePoints": "7500",
			"reason":      "seeded settled bet loyalty accrual",
		},
		CreatedBy: "system",
		CreatedAt: now.Add(-5 * time.Hour),
	})
	svc.seedLedgerEntry("u-5", canonicalv1.LoyaltyLedgerEntry{
		EntryType:    canonicalv1.LoyaltyLedgerEntryAccrual,
		EntrySubtype: "settled_lost",
		SourceType:   canonicalv1.LoyaltyLedgerSourceBetSettlement,
		SourceID:     "bet:seed:1005",
		PointsDelta:  30,
		BalanceAfter: 350,
		Metadata: map[string]string{
			"betId":       "bet:seed:1005",
			"stakePoints": "3000",
			"reason":      "seeded settled bet loyalty accrual",
		},
		CreatedBy: "system",
		CreatedAt: now.Add(-8 * time.Hour),
	})

	// --- Seed referral relationships ---
	// u-1 referred u-4 (qualified)
	svc.seedReferral("u-1", "u-4", canonicalv1.LoyaltyQualificationQualified, now.Add(-4*time.Hour))
	// u-3 referred u-5 (pending)
	svc.seedReferral("u-3", "u-5", canonicalv1.LoyaltyQualificationPending, time.Time{})

	return svc
}

func (s *Service) SetLeaderboardService(leaderboardService *leaderboards.Service) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.leaderboards = leaderboardService
}

func (s *Service) ListAccounts(filter AccountFilter) []canonicalv1.LoyaltyAccount {
	s.mu.RLock()
	defer s.mu.RUnlock()

	search := strings.ToLower(strings.TrimSpace(filter.Search))
	playerID := strings.TrimSpace(filter.PlayerID)
	tierCode := strings.TrimSpace(strings.ToLower(filter.TierCode))

	out := make([]canonicalv1.LoyaltyAccount, 0, len(s.accounts))
	for _, account := range s.accounts {
		if playerID != "" && !strings.EqualFold(account.PlayerID, playerID) {
			continue
		}
		if tierCode != "" && !strings.EqualFold(string(account.CurrentTier), tierCode) {
			continue
		}
		if search != "" {
			if !strings.Contains(strings.ToLower(account.PlayerID), search) &&
				!strings.Contains(strings.ToLower(account.AccountID), search) {
				continue
			}
		}
		out = append(out, cloneAccount(account))
	}

	sort.SliceStable(out, func(i, j int) bool {
		if out[i].PointsEarnedLifetime == out[j].PointsEarnedLifetime {
			return out[i].PlayerID < out[j].PlayerID
		}
		return out[i].PointsEarnedLifetime > out[j].PointsEarnedLifetime
	})
	return out
}

func (s *Service) GetAccount(playerID string) (canonicalv1.LoyaltyAccount, bool) {
	playerID = strings.TrimSpace(playerID)
	if playerID == "" {
		return canonicalv1.LoyaltyAccount{}, false
	}

	s.mu.RLock()
	account, ok := s.accounts[playerID]
	s.mu.RUnlock()
	if !ok {
		return canonicalv1.LoyaltyAccount{}, false
	}
	return cloneAccount(account), true
}

func (s *Service) Ledger(playerID string, limit int) []canonicalv1.LoyaltyLedgerEntry {
	playerID = strings.TrimSpace(playerID)
	if playerID == "" {
		return nil
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	entries := s.ledger[playerID]
	if limit <= 0 || limit >= len(entries) {
		out := make([]canonicalv1.LoyaltyLedgerEntry, len(entries))
		copy(out, entries)
		return out
	}
	out := make([]canonicalv1.LoyaltyLedgerEntry, limit)
	copy(out, entries[:limit])
	return out
}

func (s *Service) ListTiers() []canonicalv1.LoyaltyTier {
	s.mu.RLock()
	defer s.mu.RUnlock()

	out := make([]canonicalv1.LoyaltyTier, len(s.tiers))
	copy(out, s.tiers)
	return out
}

func (s *Service) ListRules() []canonicalv1.LoyaltyAccrualRule {
	s.mu.RLock()
	defer s.mu.RUnlock()

	out := make([]canonicalv1.LoyaltyAccrualRule, len(s.rules))
	copy(out, s.rules)
	return out
}

func (s *Service) ReferralBonusPoints() int64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.referralBonusPoints
}

func (s *Service) UpdateTier(request TierUpdateRequest) ([]canonicalv1.LoyaltyTier, error) {
	if request.TierCode == "" || strings.TrimSpace(request.DisplayName) == "" || request.Rank <= 0 || request.MinLifetimePoints < 0 {
		return nil, ErrInvalidRequest
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	found := false
	for i := range s.tiers {
		if s.tiers[i].TierCode != request.TierCode {
			continue
		}
		s.tiers[i].DisplayName = strings.TrimSpace(request.DisplayName)
		s.tiers[i].Rank = request.Rank
		s.tiers[i].MinLifetimePoints = request.MinLifetimePoints
		s.tiers[i].MinRolling30DPoints = request.MinRolling30DPoints
		s.tiers[i].Benefits = cloneStringMap(request.Benefits)
		s.tiers[i].Active = request.Active
		found = true
		break
	}
	if !found {
		return nil, ErrTierNotFound
	}

	sort.SliceStable(s.tiers, func(i, j int) bool {
		if s.tiers[i].Rank == s.tiers[j].Rank {
			return s.tiers[i].MinLifetimePoints < s.tiers[j].MinLifetimePoints
		}
		return s.tiers[i].Rank < s.tiers[j].Rank
	})

	now := s.now().UTC().Truncate(time.Second)
	for playerID, account := range s.accounts {
		s.applyTierLocked(&account, now)
		account.UpdatedAt = now
		s.accounts[playerID] = account
	}
	return append([]canonicalv1.LoyaltyTier(nil), s.tiers...), nil
}

func (s *Service) UpdateRule(request RuleUpdateRequest) ([]canonicalv1.LoyaltyAccrualRule, error) {
	if strings.TrimSpace(request.RuleID) == "" || strings.TrimSpace(request.Name) == "" || strings.TrimSpace(request.SourceType) == "" || request.Multiplier <= 0 {
		return nil, ErrInvalidRequest
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	found := false
	for i := range s.rules {
		if s.rules[i].RuleID != strings.TrimSpace(request.RuleID) {
			continue
		}
		s.rules[i].Name = strings.TrimSpace(request.Name)
		s.rules[i].SourceType = strings.TrimSpace(request.SourceType)
		s.rules[i].Active = request.Active
		s.rules[i].Multiplier = request.Multiplier
		s.rules[i].MinQualifiedStakePoints = request.MinQualifiedStakePoints
		s.rules[i].EligibleBetTypes = append([]string(nil), request.EligibleBetTypes...)
		s.rules[i].MaxPointsPerEvent = request.MaxPointsPerEvent
		s.rules[i].EffectiveFrom = cloneTime(request.EffectiveFrom)
		s.rules[i].EffectiveTo = cloneTime(request.EffectiveTo)
		found = true
		break
	}
	if !found {
		return nil, ErrRuleNotFound
	}

	out := make([]canonicalv1.LoyaltyAccrualRule, len(s.rules))
	copy(out, s.rules)
	return out, nil
}

func (s *Service) CreateRule(request RuleCreateRequest) ([]canonicalv1.LoyaltyAccrualRule, error) {
	if strings.TrimSpace(request.Name) == "" || strings.TrimSpace(request.SourceType) == "" || request.Multiplier <= 0 {
		return nil, ErrInvalidRequest
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	ruleID := fmt.Sprintf("rule:loyalty:%s-%d", strings.ReplaceAll(strings.ToLower(strings.TrimSpace(request.Name)), " ", "-"), time.Now().UnixMilli())

	rule := canonicalv1.LoyaltyAccrualRule{
		RuleID:                  ruleID,
		Name:                    strings.TrimSpace(request.Name),
		SourceType:              strings.TrimSpace(request.SourceType),
		Active:                  request.Active,
		Multiplier:              request.Multiplier,
		MinQualifiedStakePoints: request.MinQualifiedStakePoints,
		EligibleBetTypes:        append([]string(nil), request.EligibleBetTypes...),
		MaxPointsPerEvent:       request.MaxPointsPerEvent,
		EffectiveFrom:           cloneTime(request.EffectiveFrom),
		EffectiveTo:             cloneTime(request.EffectiveTo),
	}

	s.rules = append(s.rules, rule)

	out := make([]canonicalv1.LoyaltyAccrualRule, len(s.rules))
	copy(out, s.rules)
	return out, nil
}

func (s *Service) RegisterReferral(request ReferralCreateRequest) (canonicalv1.ReferralReward, error) {
	referrerID := strings.TrimSpace(request.ReferrerPlayerID)
	referredID := strings.TrimSpace(request.ReferredPlayerID)
	if referrerID == "" || referredID == "" || strings.EqualFold(referrerID, referredID) {
		return canonicalv1.ReferralReward{}, ErrInvalidRequest
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if existingID, ok := s.referralByReferred[referredID]; ok {
		existing := s.referralsByID[existingID]
		if !strings.EqualFold(existing.ReferrerPlayerID, referrerID) {
			return canonicalv1.ReferralReward{}, ErrReferralConflict
		}
		return existing, nil
	}

	now := s.now().UTC()
	s.referralSequence++
	referral := canonicalv1.ReferralReward{
		ReferralID:         fmt.Sprintf("ref:local:%06d", s.referralSequence),
		ReferrerPlayerID:   referrerID,
		ReferredPlayerID:   referredID,
		QualificationState: canonicalv1.LoyaltyQualificationPending,
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	s.referralsByID[referral.ReferralID] = referral
	s.referralByReferred[referredID] = referral.ReferralID
	s.referralIDsByReferrer[referrerID] = append(s.referralIDsByReferrer[referrerID], referral.ReferralID)
	return referral, nil
}

func (s *Service) ListReferralsByReferrer(playerID string) []canonicalv1.ReferralReward {
	playerID = strings.TrimSpace(playerID)
	if playerID == "" {
		return nil
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	ids := s.referralIDsByReferrer[playerID]
	out := make([]canonicalv1.ReferralReward, 0, len(ids))
	for _, id := range ids {
		out = append(out, s.referralsByID[id])
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].CreatedAt.After(out[j].CreatedAt)
	})
	return out
}

func (s *Service) AccrueSettledBet(request SettlementAccrualRequest) (canonicalv1.LoyaltyLedgerEntry, canonicalv1.LoyaltyAccount, error) {
	playerID := strings.TrimSpace(request.PlayerID)
	betID := strings.TrimSpace(request.BetID)
	idempotencyKey := strings.TrimSpace(request.IdempotencyKey)
	if playerID == "" || betID == "" || idempotencyKey == "" || request.StakePoints <= 0 {
		return canonicalv1.LoyaltyLedgerEntry{}, canonicalv1.LoyaltyAccount{}, ErrInvalidRequest
	}
	if status := strings.TrimSpace(strings.ToLower(request.SettlementStatus)); status != "settled_won" && status != "settled_lost" {
		return canonicalv1.LoyaltyLedgerEntry{}, canonicalv1.LoyaltyAccount{}, ErrInvalidRequest
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if existing, ok := s.accrualByKey[idempotencyKey]; ok {
		account := s.accounts[playerID]
		return cloneLedgerEntry(existing), cloneAccount(account), nil
	}

	account := s.ensureAccountLocked(playerID)
	points := s.pointsForStakeLocked(request.StakePoints)
	if points <= 0 {
		return canonicalv1.LoyaltyLedgerEntry{}, canonicalv1.LoyaltyAccount{}, ErrInvalidRequest
	}

	timestamp := request.SettledAt.UTC()
	if timestamp.IsZero() {
		timestamp = s.now().UTC()
	}
	entry := canonicalv1.LoyaltyLedgerEntry{
		EntryID:      s.nextEntryIDLocked(),
		AccountID:    account.AccountID,
		PlayerID:     playerID,
		EntryType:    canonicalv1.LoyaltyLedgerEntryAccrual,
		EntrySubtype: strings.TrimSpace(strings.ToLower(request.SettlementStatus)),
		SourceType:   canonicalv1.LoyaltyLedgerSourceBetSettlement,
		SourceID:     betID,
		PointsDelta:  points,
		BalanceAfter: account.PointsBalance + points,
		Metadata: map[string]string{
			"betId":       betID,
			"stakePoints": fmt.Sprintf("%d", request.StakePoints),
			"reason":      settlementReasonOrDefault(request.Reason, "settled bet loyalty accrual"),
		},
		CreatedBy: "system",
		CreatedAt: timestamp,
	}

	account.PointsBalance += points
	account.PointsEarnedLifetime += points
	account.PointsEarned7D += points
	account.PointsEarned30D += points
	account.PointsEarnedCurrentMonth += points
	account.LastAccrualAt = &timestamp
	account.UpdatedAt = timestamp
	s.applyTierLocked(&account, timestamp)

	s.accounts[playerID] = account
	s.ledger[playerID] = append([]canonicalv1.LoyaltyLedgerEntry{entry}, s.ledger[playerID]...)
	s.accrualByKey[idempotencyKey] = entry
	s.qualifyReferralLocked(playerID, timestamp)
	return cloneLedgerEntry(entry), cloneAccount(account), nil
}

func (s *Service) Adjust(request AdjustmentRequest) (canonicalv1.LoyaltyLedgerEntry, canonicalv1.LoyaltyAccount, error) {
	playerID := strings.TrimSpace(request.PlayerID)
	idempotencyKey := strings.TrimSpace(request.IdempotencyKey)
	if playerID == "" || idempotencyKey == "" || request.PointsDelta == 0 || strings.TrimSpace(request.Reason) == "" {
		return canonicalv1.LoyaltyLedgerEntry{}, canonicalv1.LoyaltyAccount{}, ErrInvalidRequest
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if existing, ok := s.adjustByKey[idempotencyKey]; ok {
		account := s.accounts[playerID]
		if existing.PlayerID != playerID || existing.PointsDelta != request.PointsDelta {
			return canonicalv1.LoyaltyLedgerEntry{}, canonicalv1.LoyaltyAccount{}, ErrAdjustmentConflict
		}
		return cloneLedgerEntry(existing), cloneAccount(account), nil
	}

	account := s.ensureAccountLocked(playerID)
	now := s.now().UTC()
	newBalance := account.PointsBalance + request.PointsDelta
	entry := canonicalv1.LoyaltyLedgerEntry{
		EntryID:      s.nextEntryIDLocked(),
		AccountID:    account.AccountID,
		PlayerID:     playerID,
		EntryType:    canonicalv1.LoyaltyLedgerEntryAdjustment,
		EntrySubtype: strings.TrimSpace(request.EntrySubtype),
		SourceType:   canonicalv1.LoyaltyLedgerSourceAdminManual,
		SourceID:     idempotencyKey,
		PointsDelta:  request.PointsDelta,
		BalanceAfter: newBalance,
		Metadata: map[string]string{
			"reason": strings.TrimSpace(request.Reason),
		},
		CreatedBy: strings.TrimSpace(request.CreatedBy),
		CreatedAt: now,
	}
	if entry.CreatedBy == "" {
		entry.CreatedBy = "admin"
	}

	account.PointsBalance = newBalance
	if request.PointsDelta > 0 {
		account.PointsEarnedLifetime += request.PointsDelta
		account.PointsEarned7D += request.PointsDelta
		account.PointsEarned30D += request.PointsDelta
		account.PointsEarnedCurrentMonth += request.PointsDelta
		account.LastAccrualAt = &now
	}
	account.UpdatedAt = now
	s.applyTierLocked(&account, now)

	s.accounts[playerID] = account
	s.ledger[playerID] = append([]canonicalv1.LoyaltyLedgerEntry{entry}, s.ledger[playerID]...)
	s.adjustByKey[idempotencyKey] = entry
	return cloneLedgerEntry(entry), cloneAccount(account), nil
}

func (s *Service) ensureAccountLocked(playerID string) canonicalv1.LoyaltyAccount {
	if account, ok := s.accounts[playerID]; ok {
		return account
	}
	now := s.now().UTC()
	s.accountSequence++
	account := canonicalv1.LoyaltyAccount{
		AccountID:             fmt.Sprintf("loyalty:local:%03d", s.accountSequence),
		PlayerID:              playerID,
		CurrentTier:           canonicalv1.LoyaltyTierBronze,
		PointsToNextTier:      thresholdForTier(canonicalv1.LoyaltyTierSilver),
		NextTier:              canonicalv1.LoyaltyTierSilver,
		CurrentTierAssignedAt: &now,
		CreatedAt:             now,
		UpdatedAt:             now,
	}
	s.accounts[playerID] = account
	return account
}

func (s *Service) seedAccount(playerID string, lifetime int64, balance int64, earned7d int64, earned30d int64, earnedMonth int64, createdAt time.Time, tierAssignedAt time.Time, lastAccrualAt time.Time) {
	account := s.ensureAccountLocked(playerID)
	account.PointsEarnedLifetime = lifetime
	account.PointsBalance = balance
	account.PointsEarned7D = earned7d
	account.PointsEarned30D = earned30d
	account.PointsEarnedCurrentMonth = earnedMonth
	account.CreatedAt = createdAt.UTC()
	account.UpdatedAt = lastAccrualAt.UTC()
	account.CurrentTierAssignedAt = ptrTime(tierAssignedAt.UTC())
	account.LastAccrualAt = ptrTime(lastAccrualAt.UTC())
	s.applyTierLocked(&account, tierAssignedAt.UTC())
	s.accounts[playerID] = account
}

func (s *Service) seedLedgerEntry(playerID string, entry canonicalv1.LoyaltyLedgerEntry) {
	account, ok := s.accounts[playerID]
	if !ok {
		return
	}
	if entry.EntryID == "" {
		entry.EntryID = s.nextEntryIDLocked()
	}
	entry.AccountID = account.AccountID
	entry.PlayerID = playerID
	s.ledger[playerID] = append(s.ledger[playerID], entry)
	sort.SliceStable(s.ledger[playerID], func(i, j int) bool {
		return s.ledger[playerID][i].CreatedAt.After(s.ledger[playerID][j].CreatedAt)
	})
}

func (s *Service) seedReferral(referrerID string, referredID string, state canonicalv1.LoyaltyQualificationState, qualifiedAt time.Time) {
	now := s.now().UTC()
	s.referralSequence++
	referral := canonicalv1.ReferralReward{
		ReferralID:         fmt.Sprintf("ref:seed:%06d", s.referralSequence),
		ReferrerPlayerID:   referrerID,
		ReferredPlayerID:   referredID,
		QualificationState: state,
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	if state == canonicalv1.LoyaltyQualificationQualified && !qualifiedAt.IsZero() {
		t := qualifiedAt.UTC()
		referral.QualifiedAt = &t
		referral.UpdatedAt = t
	}
	s.referralsByID[referral.ReferralID] = referral
	s.referralByReferred[referredID] = referral.ReferralID
	s.referralIDsByReferrer[referrerID] = append(s.referralIDsByReferrer[referrerID], referral.ReferralID)
}

func (s *Service) pointsForStakeLocked(stakePoints int64) int64 {
	multiplier := 1.0
	for _, rule := range s.rules {
		if !rule.Active {
			continue
		}
		if strings.TrimSpace(rule.SourceType) != string(canonicalv1.LoyaltyLedgerSourceBetSettlement) {
			continue
		}
		if stakePoints < rule.MinQualifiedStakePoints {
			return 0
		}
		multiplier = rule.Multiplier
		break
	}
	points := int64(float64(stakePoints) / 100.0 * multiplier)
	if points <= 0 {
		points = 1
	}
	return points
}

func (s *Service) applyTierLocked(account *canonicalv1.LoyaltyAccount, effectiveAt time.Time) {
	current := defaultTiers()[0]
	var next *canonicalv1.LoyaltyTier
	for i := range s.tiers {
		tier := s.tiers[i]
		if !tier.Active {
			continue
		}
		if account.PointsEarnedLifetime >= tier.MinLifetimePoints {
			current = tier
			continue
		}
		next = &tier
		break
	}

	if account.CurrentTier != current.TierCode {
		account.CurrentTier = current.TierCode
		account.CurrentTierAssignedAt = ptrTime(effectiveAt)
	}
	if next != nil {
		account.NextTier = next.TierCode
		account.PointsToNextTier = maxInt64(0, next.MinLifetimePoints-account.PointsEarnedLifetime)
	} else {
		account.NextTier = ""
		account.PointsToNextTier = 0
	}
}

func (s *Service) nextEntryIDLocked() string {
	s.entrySequence++
	return fmt.Sprintf("ll:local:%06d", s.entrySequence)
}

func (s *Service) qualifyReferralLocked(referredPlayerID string, qualifiedAt time.Time) {
	referralID, ok := s.referralByReferred[referredPlayerID]
	if !ok {
		return
	}
	referral := s.referralsByID[referralID]
	if referral.QualificationState == canonicalv1.LoyaltyQualificationQualified {
		return
	}

	referrer := s.ensureAccountLocked(referral.ReferrerPlayerID)
	entry := canonicalv1.LoyaltyLedgerEntry{
		EntryID:      s.nextEntryIDLocked(),
		AccountID:    referrer.AccountID,
		PlayerID:     referral.ReferrerPlayerID,
		EntryType:    canonicalv1.LoyaltyLedgerEntryReferralBonus,
		EntrySubtype: "first_qualified_referral",
		SourceType:   canonicalv1.LoyaltyLedgerSourceReferral,
		SourceID:     referral.ReferralID,
		PointsDelta:  s.referralBonusPoints,
		BalanceAfter: referrer.PointsBalance + s.referralBonusPoints,
		Metadata: map[string]string{
			"referredPlayerId": referredPlayerID,
			"reason":           "referral converted on first qualified settled bet",
		},
		CreatedBy: "system",
		CreatedAt: qualifiedAt,
	}

	referrer.PointsBalance += s.referralBonusPoints
	referrer.PointsEarnedLifetime += s.referralBonusPoints
	referrer.PointsEarned7D += s.referralBonusPoints
	referrer.PointsEarned30D += s.referralBonusPoints
	referrer.PointsEarnedCurrentMonth += s.referralBonusPoints
	referrer.LastAccrualAt = &qualifiedAt
	referrer.UpdatedAt = qualifiedAt
	s.applyTierLocked(&referrer, qualifiedAt)

	referral.QualificationState = canonicalv1.LoyaltyQualificationQualified
	referral.QualifiedAt = &qualifiedAt
	referral.LedgerEntryID = entry.EntryID
	referral.UpdatedAt = qualifiedAt

	s.accounts[referral.ReferrerPlayerID] = referrer
	s.ledger[referral.ReferrerPlayerID] = append([]canonicalv1.LoyaltyLedgerEntry{entry}, s.ledger[referral.ReferrerPlayerID]...)
	s.referralsByID[referral.ReferralID] = referral
	if s.leaderboards != nil {
		_ = s.leaderboards.AccrueQualifiedReferral(leaderboards.ReferralScoreRequest{
			ReferrerPlayerID: referral.ReferrerPlayerID,
			ReferralID:       referral.ReferralID,
			ReferredPlayerID: referredPlayerID,
			QualifiedAt:      qualifiedAt,
		})
	}
}

func cloneAccount(in canonicalv1.LoyaltyAccount) canonicalv1.LoyaltyAccount {
	out := in
	if in.CurrentTierAssignedAt != nil {
		t := in.CurrentTierAssignedAt.UTC()
		out.CurrentTierAssignedAt = &t
	}
	if in.LastAccrualAt != nil {
		t := in.LastAccrualAt.UTC()
		out.LastAccrualAt = &t
	}
	return out
}

func cloneLedgerEntry(in canonicalv1.LoyaltyLedgerEntry) canonicalv1.LoyaltyLedgerEntry {
	out := in
	if in.Metadata != nil {
		out.Metadata = cloneStringMap(in.Metadata)
	}
	return out
}

func cloneStringMap(in map[string]string) map[string]string {
	if in == nil {
		return nil
	}
	out := make(map[string]string, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func defaultTiers() []canonicalv1.LoyaltyTier {
	return []canonicalv1.LoyaltyTier{
		{TierCode: canonicalv1.LoyaltyTierBronze, DisplayName: "Bronze", Rank: 1, MinLifetimePoints: 0, Active: true},
		{TierCode: canonicalv1.LoyaltyTierSilver, DisplayName: "Silver", Rank: 2, MinLifetimePoints: 1000, Active: true},
		{TierCode: canonicalv1.LoyaltyTierGold, DisplayName: "Gold", Rank: 3, MinLifetimePoints: 5000, Active: true},
		{TierCode: canonicalv1.LoyaltyTierVIP, DisplayName: "VIP", Rank: 4, MinLifetimePoints: 20000, Active: true},
	}
}

func thresholdForTier(code canonicalv1.LoyaltyTierCode) int64 {
	for _, tier := range defaultTiers() {
		if tier.TierCode == code {
			return tier.MinLifetimePoints
		}
	}
	return 0
}

func settlementReasonOrDefault(reason string, fallback string) string {
	trimmed := strings.TrimSpace(reason)
	if trimmed != "" {
		return trimmed
	}
	return fallback
}

func ptrTime(v time.Time) *time.Time {
	if v.IsZero() {
		return nil
	}
	utc := v.UTC()
	return &utc
}

func cloneTime(v *time.Time) *time.Time {
	if v == nil || v.IsZero() {
		return nil
	}
	utc := v.UTC()
	return &utc
}

func maxInt64(a int64, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
