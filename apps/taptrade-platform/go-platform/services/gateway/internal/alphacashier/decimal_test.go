package alphacashier

import (
	"math/big"
	"testing"
)

func TestCentsToTokenUnitsUSDC(t *testing.T) {
	got, err := CentsToTokenUnits(2500, 6)
	if err != nil {
		t.Fatalf("CentsToTokenUnits: %v", err)
	}
	if got.String() != "25000000" {
		t.Fatalf("got %s, want 25000000", got.String())
	}
}

func TestCentsToTokenUnitsRejectsInvalidAmount(t *testing.T) {
	if _, err := CentsToTokenUnits(0, 6); err == nil {
		t.Fatalf("expected invalid amount")
	}
}

func TestTokenUnitsToCentsUSDC(t *testing.T) {
	got, err := TokenUnitsToCents(big.NewInt(25000000), 6)
	if err != nil {
		t.Fatalf("TokenUnitsToCents: %v", err)
	}
	if got != 2500 {
		t.Fatalf("got %d, want 2500", got)
	}
}

func TestTokenUnitsToCentsWithDust(t *testing.T) {
	cases := []struct {
		units    string
		decimals int
		cents    int64
		dust     string
	}{
		{"25000000", 6, 2500, "0"},
		{"25009999", 6, 2500, "9999"},
		{"9999", 6, 0, "9999"},
		{"1234999999999999999", 18, 123, "4999999999999999"},
	}
	for _, c := range cases {
		units, _ := new(big.Int).SetString(c.units, 10)
		cents, dust, err := TokenUnitsToCentsWithDust(units, c.decimals)
		if err != nil || cents != c.cents || dust.String() != c.dust {
			t.Fatalf("%s @%d: got %d dust %v err %v, want %d dust %s", c.units, c.decimals, cents, dust, err, c.cents, c.dust)
		}
	}
	if _, _, err := TokenUnitsToCentsWithDust(big.NewInt(-1), 6); err == nil {
		t.Fatalf("negative units must be rejected")
	}
}
