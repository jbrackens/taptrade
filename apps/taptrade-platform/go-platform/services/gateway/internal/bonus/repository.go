package bonus

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

const dbTimeout = 5 * time.Second

// Repository provides database access for campaigns and player bonuses.
type Repository struct {
	db *sql.DB
}

// NewRepository creates a repository backed by the provided database.
func NewRepository(db *sql.DB) *Repository {
	return &Repository{db: db}
}

// --- Campaigns ---

func (r *Repository) CreateCampaign(ctx context.Context, req CreateCampaignRequest) (Campaign, error) {
	rulesJSON, _ := json.Marshal(req.Rules)

	var c Campaign
	err := r.db.QueryRowContext(ctx, `
INSERT INTO campaigns (name, description, campaign_type, start_at, end_at, budget_points, max_claims, rules, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING id, name, description, campaign_type, status, start_at, end_at, budget_points, spent_points, max_claims, claim_count, rules, created_by, created_at, updated_at`,
		req.Name, req.Description, req.CampaignType,
		req.StartAt, req.EndAt, req.BudgetPoints, req.MaxClaims,
		rulesJSON, req.CreatedBy,
	).Scan(
		&c.ID, &c.Name, &c.Description, &c.CampaignType, &c.Status,
		&c.StartAt, &c.EndAt, &c.BudgetPoints, &c.SpentPoints,
		&c.MaxClaims, &c.ClaimCount, &c.Rules, &c.CreatedBy,
		&c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		return Campaign{}, fmt.Errorf("create campaign: %w", err)
	}

	// Insert rules
	for _, rule := range req.Rules {
		_, err := r.db.ExecContext(ctx, `
INSERT INTO campaign_rules (campaign_id, rule_type, rule_config)
VALUES ($1, $2, $3)`, c.ID, rule.RuleType, rule.RuleConfig)
		if err != nil {
			return Campaign{}, fmt.Errorf("insert campaign rule: %w", err)
		}
	}

	return c, nil
}

func (r *Repository) GetCampaign(ctx context.Context, id int64) (Campaign, error) {
	var c Campaign
	err := r.db.QueryRowContext(ctx, `
SELECT id, name, description, campaign_type, status, start_at, end_at,
       budget_points, spent_points, max_claims, claim_count, rules, created_by, created_at, updated_at
FROM campaigns WHERE id = $1`, id).Scan(
		&c.ID, &c.Name, &c.Description, &c.CampaignType, &c.Status,
		&c.StartAt, &c.EndAt, &c.BudgetPoints, &c.SpentPoints,
		&c.MaxClaims, &c.ClaimCount, &c.Rules, &c.CreatedBy,
		&c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Campaign{}, fmt.Errorf("campaign %d not found", id)
		}
		return Campaign{}, err
	}
	return c, nil
}

func (r *Repository) ListCampaigns(ctx context.Context, status string, limit int) ([]Campaign, error) {
	if limit <= 0 {
		limit = 50
	}

	var rows *sql.Rows
	var err error
	if status != "" {
		rows, err = r.db.QueryContext(ctx, `
SELECT id, name, description, campaign_type, status, start_at, end_at,
       budget_points, spent_points, max_claims, claim_count, rules, created_by, created_at, updated_at
FROM campaigns WHERE status = $1
ORDER BY updated_at DESC LIMIT $2`, status, limit)
	} else {
		rows, err = r.db.QueryContext(ctx, `
SELECT id, name, description, campaign_type, status, start_at, end_at,
       budget_points, spent_points, max_claims, claim_count, rules, created_by, created_at, updated_at
FROM campaigns ORDER BY updated_at DESC LIMIT $1`, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var campaigns []Campaign
	for rows.Next() {
		var c Campaign
		if err := rows.Scan(
			&c.ID, &c.Name, &c.Description, &c.CampaignType, &c.Status,
			&c.StartAt, &c.EndAt, &c.BudgetPoints, &c.SpentPoints,
			&c.MaxClaims, &c.ClaimCount, &c.Rules, &c.CreatedBy,
			&c.CreatedAt, &c.UpdatedAt,
		); err != nil {
			return nil, err
		}
		campaigns = append(campaigns, c)
	}
	return campaigns, rows.Err()
}

func (r *Repository) UpdateCampaignStatus(ctx context.Context, id int64, newStatus string) error {
	result, err := r.db.ExecContext(ctx, `
UPDATE campaigns SET status = $2, updated_at = NOW() WHERE id = $1`, id, newStatus)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return fmt.Errorf("campaign %d not found", id)
	}
	return nil
}

func (r *Repository) IncrementClaimCount(ctx context.Context, campaignID int64, spentPoints int64) error {
	_, err := r.db.ExecContext(ctx, `
UPDATE campaigns SET claim_count = claim_count + 1, spent_points = spent_points + $2, updated_at = NOW()
WHERE id = $1`, campaignID, spentPoints)
	return err
}

// ErrCampaignLimitReached indicates an atomic claim-count/budget reservation
// was rejected because the campaign is at its claim cap or would exceed budget.
var ErrCampaignLimitReached = errors.New("campaign claim or budget limit reached")

// ReserveClaim atomically increments claim_count and spent_points only if the
// campaign still has claim and budget headroom. It is the race-safe replacement
// for the read-then-IncrementClaimCount pattern: concurrent claims can no
// longer push claim_count past max_claims or spent_points past budget_points.
// Returns ErrCampaignLimitReached if no row qualified.
func (r *Repository) ReserveClaim(ctx context.Context, campaignID int64, amountPoints int64) error {
	res, err := r.db.ExecContext(ctx, `
UPDATE campaigns
SET claim_count = claim_count + 1,
    spent_points = spent_points + $2,
    updated_at = NOW()
WHERE id = $1
  AND status = 'active'
  AND (max_claims IS NULL OR claim_count < max_claims)
  AND (budget_points IS NULL OR spent_points + $2 <= budget_points)`,
		campaignID, amountPoints)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrCampaignLimitReached
	}
	return nil
}

// ReleaseClaim reverses a ReserveClaim reservation. Used to compensate when a
// downstream step (e.g. creating the player_bonus row) fails after the claim
// slot was reserved, so the campaign counters do not drift.
func (r *Repository) ReleaseClaim(ctx context.Context, campaignID int64, amountPoints int64) error {
	_, err := r.db.ExecContext(ctx, `
UPDATE campaigns
SET claim_count = GREATEST(claim_count - 1, 0),
    spent_points = GREATEST(spent_points - $2, 0),
    updated_at = NOW()
WHERE id = $1`,
		campaignID, amountPoints)
	return err
}

// PunterRegistration holds the eligibility-relevant fields for a punter.
type PunterRegistration struct {
	Found     bool
	Status    string
	CreatedAt time.Time
}

// GetPunterRegistration returns the punter's status and registration time for
// eligibility checks. Found is false (no error) when the punter row is absent,
// so callers can decide how to treat unknown users.
func (r *Repository) GetPunterRegistration(ctx context.Context, userID string) (PunterRegistration, error) {
	var pr PunterRegistration
	err := r.db.QueryRowContext(ctx, `
SELECT status, created_at FROM punters WHERE id = $1`, userID).Scan(&pr.Status, &pr.CreatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return PunterRegistration{Found: false}, nil
		}
		return PunterRegistration{}, err
	}
	pr.Found = true
	return pr, nil
}

// GetCampaignRules returns all rules for a campaign, keyed by rule_type.
func (r *Repository) GetCampaignRules(ctx context.Context, campaignID int64) ([]CampaignRule, error) {
	rows, err := r.db.QueryContext(ctx, `
SELECT id, campaign_id, rule_type, rule_config, created_at
FROM campaign_rules WHERE campaign_id = $1
ORDER BY rule_type`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rules []CampaignRule
	for rows.Next() {
		var rule CampaignRule
		if err := rows.Scan(&rule.ID, &rule.CampaignID, &rule.RuleType, &rule.RuleConfig, &rule.CreatedAt); err != nil {
			return nil, err
		}
		rules = append(rules, rule)
	}
	return rules, rows.Err()
}

// ListActiveCampaigns returns campaigns currently in the "active" window.
func (r *Repository) ListActiveCampaigns(ctx context.Context) ([]Campaign, error) {
	rows, err := r.db.QueryContext(ctx, `
SELECT id, name, description, campaign_type, status, start_at, end_at,
       budget_points, spent_points, max_claims, claim_count, rules, created_by, created_at, updated_at
FROM campaigns
WHERE status = 'active' AND start_at <= NOW() AND end_at >= NOW()
ORDER BY start_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var campaigns []Campaign
	for rows.Next() {
		var c Campaign
		if err := rows.Scan(
			&c.ID, &c.Name, &c.Description, &c.CampaignType, &c.Status,
			&c.StartAt, &c.EndAt, &c.BudgetPoints, &c.SpentPoints,
			&c.MaxClaims, &c.ClaimCount, &c.Rules, &c.CreatedBy,
			&c.CreatedAt, &c.UpdatedAt,
		); err != nil {
			return nil, err
		}
		campaigns = append(campaigns, c)
	}
	return campaigns, rows.Err()
}

// --- Player Bonuses ---

func (r *Repository) CreatePlayerBonus(ctx context.Context, pb PlayerBonus) (PlayerBonus, error) {
	err := r.db.QueryRowContext(ctx, `
INSERT INTO player_bonuses (user_id, campaign_id, bonus_type, status,
    granted_amount_points, remaining_amount_points, expires_at, metadata)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, granted_at, created_at, updated_at`,
		pb.UserID, pb.CampaignID, pb.BonusType, pb.Status,
		pb.GrantedAmountPoints, pb.RemainingAmountPoints,
		pb.ExpiresAt, pb.Metadata,
	).Scan(&pb.ID, &pb.GrantedAt, &pb.CreatedAt, &pb.UpdatedAt)
	if err != nil {
		return PlayerBonus{}, fmt.Errorf("create player bonus: %w", err)
	}
	return pb, nil
}

func (r *Repository) GetPlayerBonus(ctx context.Context, id int64) (PlayerBonus, error) {
	var pb PlayerBonus
	err := r.db.QueryRowContext(ctx, `
SELECT id, user_id, campaign_id, bonus_type, status,
       granted_amount_points, remaining_amount_points,
       expires_at, granted_at, completed_at, forfeited_at, COALESCE(forfeited_by, ''),
       COALESCE(metadata, '{}'), created_at, updated_at
FROM player_bonuses WHERE id = $1`, id).Scan(
		&pb.ID, &pb.UserID, &pb.CampaignID, &pb.BonusType, &pb.Status,
		&pb.GrantedAmountPoints, &pb.RemainingAmountPoints,
		&pb.ExpiresAt, &pb.GrantedAt, &pb.CompletedAt, &pb.ForfeitedAt, &pb.ForfeitedBy,
		&pb.Metadata, &pb.CreatedAt, &pb.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return PlayerBonus{}, fmt.Errorf("player bonus %d not found", id)
		}
		return PlayerBonus{}, err
	}
	return pb, nil
}

func (r *Repository) ListPlayerBonuses(ctx context.Context, userID string, status string, limit int) ([]PlayerBonus, error) {
	if limit <= 0 {
		limit = 50
	}

	query := `
SELECT id, user_id, campaign_id, bonus_type, status,
       granted_amount_points, remaining_amount_points,
       expires_at, granted_at, completed_at, forfeited_at, COALESCE(forfeited_by, ''),
       COALESCE(metadata, '{}'), created_at, updated_at
FROM player_bonuses WHERE 1=1`
	args := []any{}
	argIdx := 1

	if userID != "" {
		query += fmt.Sprintf(" AND user_id = $%d", argIdx)
		args = append(args, userID)
		argIdx++
	}
	if status != "" {
		query += fmt.Sprintf(" AND status = $%d", argIdx)
		args = append(args, status)
		argIdx++
	}
	query += fmt.Sprintf(" ORDER BY granted_at DESC LIMIT $%d", argIdx)
	args = append(args, limit)

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var bonuses []PlayerBonus
	for rows.Next() {
		var pb PlayerBonus
		if err := rows.Scan(
			&pb.ID, &pb.UserID, &pb.CampaignID, &pb.BonusType, &pb.Status,
			&pb.GrantedAmountPoints, &pb.RemainingAmountPoints,
			&pb.ExpiresAt, &pb.GrantedAt, &pb.CompletedAt, &pb.ForfeitedAt, &pb.ForfeitedBy,
			&pb.Metadata, &pb.CreatedAt, &pb.UpdatedAt,
		); err != nil {
			return nil, err
		}
		bonuses = append(bonuses, pb)
	}
	return bonuses, rows.Err()
}

func (r *Repository) UpdateBonusStatus(ctx context.Context, id int64, status string, actor string) error {
	now := time.Now().UTC()
	var query string
	switch status {
	case "completed":
		query = `UPDATE player_bonuses SET status = $2, completed_at = $3, updated_at = $3 WHERE id = $1`
	case "expired":
		query = `UPDATE player_bonuses SET status = $2, forfeited_at = $3, forfeited_by = 'system', updated_at = $3 WHERE id = $1`
	case "forfeited":
		query = `UPDATE player_bonuses SET status = $2, forfeited_at = $3, forfeited_by = $4, updated_at = $3 WHERE id = $1`
		_, err := r.db.ExecContext(ctx, query, id, status, now, actor)
		return err
	default:
		query = `UPDATE player_bonuses SET status = $2, updated_at = $3 WHERE id = $1`
	}
	_, err := r.db.ExecContext(ctx, query, id, status, now)
	return err
}

// ListExpiredActiveBonuses returns active bonuses past their expiry date.
func (r *Repository) ListExpiredActiveBonuses(ctx context.Context) ([]PlayerBonus, error) {
	rows, err := r.db.QueryContext(ctx, `
SELECT id, user_id, campaign_id, bonus_type, status,
       granted_amount_points, remaining_amount_points,
       expires_at, granted_at, completed_at, forfeited_at, COALESCE(forfeited_by, ''),
       COALESCE(metadata, '{}'), created_at, updated_at
FROM player_bonuses
WHERE status = 'active' AND expires_at < NOW()
LIMIT 500`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var bonuses []PlayerBonus
	for rows.Next() {
		var pb PlayerBonus
		if err := rows.Scan(
			&pb.ID, &pb.UserID, &pb.CampaignID, &pb.BonusType, &pb.Status,
			&pb.GrantedAmountPoints, &pb.RemainingAmountPoints,
			&pb.ExpiresAt, &pb.GrantedAt, &pb.CompletedAt, &pb.ForfeitedAt, &pb.ForfeitedBy,
			&pb.Metadata, &pb.CreatedAt, &pb.UpdatedAt,
		); err != nil {
			return nil, err
		}
		bonuses = append(bonuses, pb)
	}
	return bonuses, rows.Err()
}

// HasExistingBonus checks if a player already has a bonus for a given campaign.
func (r *Repository) HasExistingBonus(ctx context.Context, userID string, campaignID int64) (bool, error) {
	var count int
	err := r.db.QueryRowContext(ctx, `
SELECT COUNT(1) FROM player_bonuses WHERE user_id = $1 AND campaign_id = $2`,
		userID, campaignID).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// CloseExpiredCampaigns transitions active campaigns past their end_at to closed.
func (r *Repository) CloseExpiredCampaigns(ctx context.Context) ([]Campaign, error) {
	rows, err := r.db.QueryContext(ctx, `
UPDATE campaigns SET status = 'closed', updated_at = NOW()
WHERE status = 'active' AND end_at < NOW()
RETURNING id, name, description, campaign_type, status, start_at, end_at,
          budget_points, spent_points, max_claims, claim_count, rules, created_by, created_at, updated_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var campaigns []Campaign
	for rows.Next() {
		var c Campaign
		if err := rows.Scan(
			&c.ID, &c.Name, &c.Description, &c.CampaignType, &c.Status,
			&c.StartAt, &c.EndAt, &c.BudgetPoints, &c.SpentPoints,
			&c.MaxClaims, &c.ClaimCount, &c.Rules, &c.CreatedBy,
			&c.CreatedAt, &c.UpdatedAt,
		); err != nil {
			return nil, err
		}
		campaigns = append(campaigns, c)
	}
	return campaigns, rows.Err()
}
