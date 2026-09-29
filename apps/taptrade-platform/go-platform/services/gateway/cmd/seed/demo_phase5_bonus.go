package main

import (
	"context"
	"database/sql"
	"fmt"
)

const (
	demoActiveBonusName                = "Demo Point-Play Bonus"
	demoActiveBonusBudgetPoints        = int64(1_000_000)
	demoActiveBonusGrantedPoints       = int64(20_000)
	demoActiveBonusRemainingPoints     = int64(15_000)
	demoActiveBonusPlayRequiredPoints  = int64(100_000)
	demoActiveBonusPlayCompletedPoints = int64(25_000)
)

// RunPhase5BonusDemo seeds one active point-play bonus grant for the demo user
// so /rewards can show the real active-bonus progress panel immediately after
// demo data is loaded.
func RunPhase5BonusDemo(ctx context.Context, db *sql.DB) (int64, error) {
	var count int64
	err := db.QueryRowContext(ctx, `
WITH campaign AS (
  INSERT INTO campaigns (
    name, description, campaign_type, status,
    start_at, end_at, budget_points, spent_points, max_claims,
    claim_count, rules, created_by
  )
  VALUES (
    $7,
    'Demo campaign for active point-play progress on the rewards page.',
    'custom',
    'active',
    NOW() - INTERVAL '1 day',
    NOW() + INTERVAL '14 days',
    $1,
    $2,
    500,
    1,
    '[]'::jsonb,
    'demo-seed'
  )
  RETURNING id
),
reward_rule AS (
  INSERT INTO campaign_rules (campaign_id, rule_type, rule_config)
  SELECT id, 'reward', jsonb_build_object(
    'type', 'fixed',
    'fixed_amount_points', $2,
    'expiry_days', 14
  )
  FROM campaign
),
grant_row AS (
  INSERT INTO player_bonuses (
    user_id, campaign_id, bonus_type, status,
    granted_amount_points, remaining_amount_points,
    expires_at, metadata
  )
  SELECT
    $3,
    id,
    'custom',
    'active',
    $2,
    $4,
    NOW() + INTERVAL '14 days',
    jsonb_build_object(
      'campaign_name', $7,
      'granted_by', 'demo-seed',
      'reason', 'demo active bonus',
      'demo_seed', true
    )
  FROM campaign
  RETURNING id
)
SELECT COUNT(*) FROM grant_row`,
		demoActiveBonusBudgetPoints,
		demoActiveBonusGrantedPoints,
		demoUserID,
		demoActiveBonusRemainingPoints,
		demoActiveBonusName,
	).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("seed demo active bonus: %w", err)
	}
	return count, nil
}
