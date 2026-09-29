// Package approval is a two-person rule for back-office actions that create
// Points or settle markets: an action over a threshold waits for a second
// admin before it runs.
//
// Not wired yet (2026-09-29). Candidates are admin wallet credits (one admin
// with finances:write can credit any amount) and manual settlement (one admin
// with settlements:resolve pays out a whole market); wiring either needs an
// approvals table, approve/reject endpoints and a back-office queue, and is a
// product decision.
//
// Salvaged from the orphaned internal/cashier with the two defects the
// 2026-06-14 security review found there fixed: an unset threshold no longer
// skips review, and the requester never counts as their own approver.
package approval

import "strings"

// Decision is what happens to an action, from least to most strict.
type Decision string

const (
	Allow  Decision = "allow"  // run it now
	Review Decision = "review" // wait for a second admin
	Deny   Decision = "deny"   // refuse it
)

func (d Decision) rank() int {
	switch d {
	case Allow:
		return 0
	case Review:
		return 1
	default:
		return 2 // Deny, and anything unknown
	}
}

// Result is a decision with every reason that contributed to it.
type Result struct {
	Decision Decision
	Reasons  []string
}

// Escalate records reason and raises the decision to d if d is stricter.
// Checks combine by escalating one Result.
func (r *Result) Escalate(d Decision, reason string) {
	if r.Decision == "" {
		r.Decision = Allow
	}
	r.Reasons = append(r.Reasons, reason)
	if d.rank() > r.Decision.rank() {
		r.Decision = d
	}
}

// Threshold sends Points amounts above ReviewAbovePoints to review. Zero or
// negative means no threshold was configured, and every amount goes to
// review: a missing setting must not wave actions through.
type Threshold struct {
	ReviewAbovePoints int64
}

// Evaluate decides one amount.
func (t Threshold) Evaluate(amountPoints int64) Result {
	result := Result{Decision: Allow}
	switch {
	case amountPoints <= 0:
		result.Escalate(Deny, "amount_not_positive")
	case t.ReviewAbovePoints <= 0:
		result.Escalate(Review, "review_threshold_unset")
	case amountPoints > t.ReviewAbovePoints:
		result.Escalate(Review, "above_review_threshold")
	}
	return result
}

// Vote is one admin's answer to a pending action.
type Vote string

const (
	Approve Vote = "approve"
	Reject  Vote = "reject"
)

// Approval is one admin's vote on a pending action.
type Approval struct {
	ActorID string
	Vote    Vote
}

// Approved reports whether a pending action may run: an admin other than
// the requester approved it and nobody rejected it. Actor ids compare
// trimmed and case-insensitively (sessions carry emails); blank ids are
// ignored, and a blank requester is never approved, since they could not be
// told apart from the approver.
func Approved(requesterID string, approvals []Approval) bool {
	requester := normalizeActor(requesterID)
	if requester == "" {
		return false
	}
	approved := false
	for _, a := range approvals {
		actor := normalizeActor(a.ActorID)
		if actor == "" {
			continue
		}
		switch a.Vote {
		case Reject:
			return false
		case Approve:
			if actor != requester {
				approved = true
			}
		}
	}
	return approved
}

func normalizeActor(id string) string {
	return strings.ToLower(strings.TrimSpace(id))
}
