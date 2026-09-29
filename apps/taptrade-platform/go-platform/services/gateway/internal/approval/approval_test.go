package approval

import (
	"reflect"
	"testing"
)

func TestThresholdEvaluate(t *testing.T) {
	cases := []struct {
		name      string
		threshold int64
		amount    int64
		want      Decision
		reasons   []string
	}{
		{"at the threshold runs now", 10_000, 10_000, Allow, nil},
		{"above the threshold waits", 10_000, 10_001, Review, []string{"above_review_threshold"}},
		// The review's fail-open cap: an unset threshold used to skip the check.
		{"unset threshold reviews everything", 0, 1, Review, []string{"review_threshold_unset"}},
		{"negative threshold reviews everything", -5, 1, Review, []string{"review_threshold_unset"}},
		{"zero amount is refused", 10_000, 0, Deny, []string{"amount_not_positive"}},
		{"negative amount is refused", 0, -1, Deny, []string{"amount_not_positive"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Threshold{ReviewAbovePoints: tc.threshold}.Evaluate(tc.amount)
			if got.Decision != tc.want || !reflect.DeepEqual(got.Reasons, tc.reasons) {
				t.Fatalf("Evaluate(%d) = %+v, want %s %v", tc.amount, got, tc.want, tc.reasons)
			}
		})
	}
}

func TestEscalateKeepsTheStrictestDecision(t *testing.T) {
	var r Result
	r.Escalate(Review, "above_review_threshold")
	r.Escalate(Deny, "market_already_settled")
	r.Escalate(Review, "high_volume_market")
	if r.Decision != Deny {
		t.Fatalf("decision = %s, want deny", r.Decision)
	}
	want := []string{"above_review_threshold", "market_already_settled", "high_volume_market"}
	if !reflect.DeepEqual(r.Reasons, want) {
		t.Fatalf("reasons = %v, want %v", r.Reasons, want)
	}
}

func TestApproved(t *testing.T) {
	const requester = "ops@taptrade.local"
	cases := []struct {
		name      string
		requester string
		approvals []Approval
		want      bool
	}{
		{"no votes", requester, nil, false},
		// The review's initiator-not-excluded defect: the requester's own
		// approval used to count toward the two people.
		{"requester approving alone", requester, []Approval{{requester, Approve}}, false},
		{"requester under another spelling", requester, []Approval{{"  OPS@taptrade.local ", Approve}}, false},
		{"a second admin approves", requester, []Approval{{requester, Approve}, {"admin@taptrade.local", Approve}}, true},
		{"any rejection blocks", requester, []Approval{{"admin@taptrade.local", Approve}, {"support@taptrade.local", Reject}}, false},
		{"blank approver ignored", requester, []Approval{{"  ", Approve}}, false},
		{"unknown vote ignored", requester, []Approval{{"admin@taptrade.local", "abstain"}}, false},
		{"blank requester never approved", "", []Approval{{"admin@taptrade.local", Approve}}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Approved(tc.requester, tc.approvals); got != tc.want {
				t.Fatalf("Approved() = %v, want %v", got, tc.want)
			}
		})
	}
}
