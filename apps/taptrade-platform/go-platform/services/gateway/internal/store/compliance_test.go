package store

import (
	"context"
	"testing"
)

// TestNilComplianceGateIsNoOp — without wiring, checkout and fulfillment
// behave exactly as with the jurisdiction gate absent.
func TestNilComplianceGateIsNoOp(t *testing.T) {
	prev := ComplianceGate
	ComplianceGate = nil
	t.Cleanup(func() { ComplianceGate = prev })
	f := newFixture(t, Config{})
	purchase := checkoutSuccess(t, f, "u-nil", "popular", "k-nil-1")
	if _, already, err := f.svc.Confirm(context.Background(), purchase, "success"); err != nil || already {
		t.Fatalf("confirm with nil gate: already=%v err=%v", already, err)
	}
}
