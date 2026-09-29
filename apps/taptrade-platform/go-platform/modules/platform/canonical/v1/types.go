package v1

import "time"

// EntityType names the canonical record kinds still in use: loyalty,
// leaderboards and translations. The sportsbook kinds were removed on
// 2026-09-29.
type EntityType string

const (
	EntityLoyaltyAccount      EntityType = "loyalty_account"
	EntityLoyaltyLedger       EntityType = "loyalty_ledger_entry"
	EntityLeaderboard         EntityType = "leaderboard"
	EntityLeaderboardEvent    EntityType = "leaderboard_event"
	EntityLeaderboardStanding EntityType = "leaderboard_standing"
	EntityTranslation         EntityType = "translation"
)

type LoyaltyTierCode string

const (
	LoyaltyTierBronze LoyaltyTierCode = "bronze"
	LoyaltyTierSilver LoyaltyTierCode = "silver"
	LoyaltyTierGold   LoyaltyTierCode = "gold"
	LoyaltyTierVIP    LoyaltyTierCode = "vip"
)

type LoyaltyLedgerEntryType string

const (
	LoyaltyLedgerEntryAccrual       LoyaltyLedgerEntryType = "accrual"
	LoyaltyLedgerEntryAdjustment    LoyaltyLedgerEntryType = "adjustment"
	LoyaltyLedgerEntryReferralBonus LoyaltyLedgerEntryType = "referral_bonus"
	LoyaltyLedgerEntryPromoBonus    LoyaltyLedgerEntryType = "promo_bonus"
	LoyaltyLedgerEntryReversal      LoyaltyLedgerEntryType = "reversal"
	LoyaltyLedgerEntryExpiration    LoyaltyLedgerEntryType = "expiration"
	LoyaltyLedgerEntryRedemption    LoyaltyLedgerEntryType = "redemption"
)

type LoyaltyLedgerSourceType string

const (
	LoyaltyLedgerSourceBetSettlement LoyaltyLedgerSourceType = "bet_settlement"
	LoyaltyLedgerSourceAdminManual   LoyaltyLedgerSourceType = "admin_manual"
	LoyaltyLedgerSourceReferral      LoyaltyLedgerSourceType = "referral"
	LoyaltyLedgerSourceCampaign      LoyaltyLedgerSourceType = "campaign"
	LoyaltyLedgerSourceSystemRecalc  LoyaltyLedgerSourceType = "system_recalc"
)

type LoyaltyQualificationState string

const (
	LoyaltyQualificationPending   LoyaltyQualificationState = "pending"
	LoyaltyQualificationQualified LoyaltyQualificationState = "qualified"
	LoyaltyQualificationRejected  LoyaltyQualificationState = "rejected"
)

type LoyaltyAccount struct {
	AccountID                string          `json:"accountId"`
	PlayerID                 string          `json:"playerId"`
	PointsBalance            int64           `json:"pointsBalance"`
	PointsEarnedLifetime     int64           `json:"pointsEarnedLifetime"`
	PointsEarned7D           int64           `json:"pointsEarned7d,omitempty"`
	PointsEarned30D          int64           `json:"pointsEarned30d,omitempty"`
	PointsEarnedCurrentMonth int64           `json:"pointsEarnedCurrentMonth,omitempty"`
	CurrentTier              LoyaltyTierCode `json:"currentTier"`
	CurrentTierAssignedAt    *time.Time      `json:"currentTierAssignedAt,omitempty"`
	PointsToNextTier         int64           `json:"pointsToNextTier,omitempty"`
	NextTier                 LoyaltyTierCode `json:"nextTier,omitempty"`
	LastAccrualAt            *time.Time      `json:"lastAccrualAt,omitempty"`
	CreatedAt                time.Time       `json:"createdAt"`
	UpdatedAt                time.Time       `json:"updatedAt"`
}

type LoyaltyLedgerEntry struct {
	EntryID      string                  `json:"entryId"`
	AccountID    string                  `json:"accountId"`
	PlayerID     string                  `json:"playerId"`
	EntryType    LoyaltyLedgerEntryType  `json:"entryType"`
	EntrySubtype string                  `json:"entrySubtype,omitempty"`
	SourceType   LoyaltyLedgerSourceType `json:"sourceType"`
	SourceID     string                  `json:"sourceId,omitempty"`
	PointsDelta  int64                   `json:"pointsDelta"`
	BalanceAfter int64                   `json:"balanceAfter"`
	Metadata     map[string]string       `json:"metadata,omitempty"`
	CreatedBy    string                  `json:"createdBy,omitempty"`
	CreatedAt    time.Time               `json:"createdAt"`
}

type LoyaltyTier struct {
	TierCode            LoyaltyTierCode   `json:"tierCode"`
	DisplayName         string            `json:"displayName"`
	Rank                int               `json:"rank"`
	MinLifetimePoints   int64             `json:"minLifetimePoints"`
	MinRolling30DPoints int64             `json:"minRolling30dPoints,omitempty"`
	Benefits            map[string]string `json:"benefits,omitempty"`
	Active              bool              `json:"active"`
}

type LoyaltyAccrualRule struct {
	RuleID                  string     `json:"ruleId"`
	Name                    string     `json:"name"`
	SourceType              string     `json:"sourceType"`
	Active                  bool       `json:"active"`
	Multiplier              float64    `json:"multiplier"`
	MinQualifiedStakePoints int64      `json:"minQualifiedStakePoints,omitempty"`
	EligibleBetTypes        []string   `json:"eligibleBetTypes,omitempty"`
	MaxPointsPerEvent       int64      `json:"maxPointsPerEvent,omitempty"`
	EffectiveFrom           *time.Time `json:"effectiveFrom,omitempty"`
	EffectiveTo             *time.Time `json:"effectiveTo,omitempty"`
}

type ReferralReward struct {
	ReferralID         string                    `json:"referralId"`
	ReferrerPlayerID   string                    `json:"referrerPlayerId"`
	ReferredPlayerID   string                    `json:"referredPlayerId"`
	QualificationState LoyaltyQualificationState `json:"qualificationState"`
	QualifiedAt        *time.Time                `json:"qualifiedAt,omitempty"`
	LedgerEntryID      string                    `json:"ledgerEntryId,omitempty"`
	CreatedAt          time.Time                 `json:"createdAt"`
	UpdatedAt          time.Time                 `json:"updatedAt"`
}

type LeaderboardRankingMode string

const (
	LeaderboardRankingModeSum LeaderboardRankingMode = "sum"
	LeaderboardRankingModeMin LeaderboardRankingMode = "min"
	LeaderboardRankingModeMax LeaderboardRankingMode = "max"
)

type LeaderboardOrder string

const (
	LeaderboardOrderAscending  LeaderboardOrder = "asc"
	LeaderboardOrderDescending LeaderboardOrder = "desc"
)

type LeaderboardStatus string

const (
	LeaderboardStatusDraft  LeaderboardStatus = "draft"
	LeaderboardStatusActive LeaderboardStatus = "active"
	LeaderboardStatusClosed LeaderboardStatus = "closed"
)

type LeaderboardDefinition struct {
	LeaderboardID  string                 `json:"leaderboardId"`
	Slug           string                 `json:"slug,omitempty"`
	Name           string                 `json:"name"`
	Description    string                 `json:"description,omitempty"`
	MetricKey      string                 `json:"metricKey"`
	EventType      string                 `json:"eventType,omitempty"`
	RankingMode    LeaderboardRankingMode `json:"rankingMode"`
	Order          LeaderboardOrder       `json:"order"`
	Status         LeaderboardStatus      `json:"status"`
	Currency       string                 `json:"currency,omitempty"`
	PrizeSummary   string                 `json:"prizeSummary,omitempty"`
	WindowStartsAt *time.Time             `json:"windowStartsAt,omitempty"`
	WindowEndsAt   *time.Time             `json:"windowEndsAt,omitempty"`
	LastComputedAt *time.Time             `json:"lastComputedAt,omitempty"`
	CreatedBy      string                 `json:"createdBy,omitempty"`
	CreatedAt      time.Time              `json:"createdAt"`
	UpdatedAt      time.Time              `json:"updatedAt"`
}

type LeaderboardEvent struct {
	EventID        string            `json:"eventId"`
	LeaderboardID  string            `json:"leaderboardId"`
	PlayerID       string            `json:"playerId"`
	Score          float64           `json:"score"`
	SourceType     string            `json:"sourceType,omitempty"`
	SourceID       string            `json:"sourceId,omitempty"`
	IdempotencyKey string            `json:"idempotencyKey,omitempty"`
	Metadata       map[string]string `json:"metadata,omitempty"`
	RecordedAt     time.Time         `json:"recordedAt"`
}

type LeaderboardStanding struct {
	LeaderboardID string            `json:"leaderboardId"`
	PlayerID      string            `json:"playerId"`
	Rank          int               `json:"rank"`
	Score         float64           `json:"score"`
	EventCount    int               `json:"eventCount"`
	LastEventAt   *time.Time        `json:"lastEventAt,omitempty"`
	Metadata      map[string]string `json:"metadata,omitempty"`
}

type Translation struct {
	Locale     string            `json:"locale"`
	EntityType EntityType        `json:"entityType"`
	EntityID   string            `json:"entityId"`
	Fields     map[string]string `json:"fields"`
	UpdatedAt  time.Time         `json:"updatedAt"`
}
