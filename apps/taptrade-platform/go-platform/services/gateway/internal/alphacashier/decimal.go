package alphacashier

import (
	"fmt"
	"math/big"
)

func CentsToTokenUnits(cents int64, tokenDecimals int) (*big.Int, error) {
	if cents <= 0 {
		return nil, ErrInvalidAmount
	}
	if tokenDecimals < 2 || tokenDecimals > 30 {
		return nil, fmt.Errorf("token decimals must be between 2 and 30")
	}
	scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(tokenDecimals)), nil)
	if new(big.Int).Mod(scale, big.NewInt(100)).Sign() != 0 {
		return nil, fmt.Errorf("token decimals cannot exactly represent cents")
	}
	unitsPerCent := new(big.Int).Div(scale, big.NewInt(100))
	return new(big.Int).Mul(big.NewInt(cents), unitsPerCent), nil
}

func TokenUnitsToCents(units *big.Int, tokenDecimals int) (int64, error) {
	cents, _, err := TokenUnitsToCentsWithDust(units, tokenDecimals)
	return cents, err
}

// TokenUnitsToCentsWithDust converts base units to whole cents, truncating
// (never rounding up: that would count value that is not there) and
// returning the sub-cent remainder in base units, so reconciliation can
// attribute it instead of losing it silently. Ported from the
// feat/hula-na-cashier rail (usdt_conversion.go), 2026-09-29.
//
// 6 decimals: 25_000_000 -> 2500 cents, dust 0; 25_009_999 -> 2500, dust 9_999.
func TokenUnitsToCentsWithDust(units *big.Int, tokenDecimals int) (int64, *big.Int, error) {
	if units == nil || units.Sign() < 0 {
		return 0, nil, ErrInvalidAmount
	}
	if tokenDecimals < 2 || tokenDecimals > 30 {
		return 0, nil, fmt.Errorf("token decimals must be between 2 and 30")
	}
	scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(tokenDecimals)), nil)
	if new(big.Int).Mod(scale, big.NewInt(100)).Sign() != 0 {
		return 0, nil, fmt.Errorf("token decimals cannot exactly represent cents")
	}
	unitsPerCent := new(big.Int).Div(scale, big.NewInt(100))
	cents, dust := new(big.Int).QuoRem(units, unitsPerCent, new(big.Int))
	if !cents.IsInt64() {
		return 0, nil, ErrInvalidAmount
	}
	return cents.Int64(), dust, nil
}
