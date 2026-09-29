package wallet

import (
	"context"
	"testing"
)

func TestForfeitBonus_MemoryMode_NoOp(t *testing.T) {
	svc := NewService()

	// In memory mode, ForfeitBonus is a no-op (returns nil)
	_, err := svc.ForfeitBonus(context.Background(), "u-forfeit", 500, "test reason", "forfeit-key-1")
	if err != nil {
		t.Fatalf("forfeit should be no-op in memory mode, got: %v", err)
	}
}

func TestDebitBonus_MemoryMode_FallsBackToRegularDebit(t *testing.T) {
	svc := NewService()

	// Seed balance
	_, err := svc.Credit(context.Background(), MutationRequest{
		UserID: "u-db1", AmountPoints: 1000, IdempotencyKey: "seed-db1", Reason: "deposit",
	})
	if err != nil {
		t.Fatalf("credit: %v", err)
	}

	// In memory mode, DebitBonus falls back to regular debit
	entry, err := svc.DebitBonus(context.Background(), MutationRequest{
		UserID: "u-db1", AmountPoints: 300, IdempotencyKey: "db1", Reason: "bonus debit",
	})
	if err != nil {
		t.Fatalf("debit bonus: %v", err)
	}
	if entry.BalancePoints != 700 {
		t.Fatalf("expected balance 700 after bonus debit, got %d", entry.BalancePoints)
	}
}

func TestBalanceWithBreakdown_MemoryMode(t *testing.T) {
	svc := NewService()

	_, err := svc.Credit(context.Background(), MutationRequest{
		UserID: "u-bb1", AmountPoints: 500, IdempotencyKey: "seed-bb1", Reason: "deposit",
	})
	if err != nil {
		t.Fatalf("credit: %v", err)
	}

	breakdown := svc.BalanceWithBreakdown(context.Background(), "u-bb1")
	if breakdown.RealMoneyPoints != 500 {
		t.Fatalf("expected real 500, got %d", breakdown.RealMoneyPoints)
	}
	if breakdown.BonusFundPoints != 0 {
		t.Fatalf("expected bonus 0 in memory mode, got %d", breakdown.BonusFundPoints)
	}
	if breakdown.TotalPoints != 500 {
		t.Fatalf("expected total 500, got %d", breakdown.TotalPoints)
	}
}

func TestMin64(t *testing.T) {
	if min64(5, 10) != 5 {
		t.Fatal("min64(5,10) should be 5")
	}
	if min64(10, 5) != 5 {
		t.Fatal("min64(10,5) should be 5")
	}
	if min64(5, 5) != 5 {
		t.Fatal("min64(5,5) should be 5")
	}
}
