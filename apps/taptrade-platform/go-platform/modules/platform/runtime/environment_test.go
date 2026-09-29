package runtime

import (
	"strings"
	"testing"
)

func TestValidateEnvironment(t *testing.T) {
	for _, ok := range []string{"", "production", "staging", "development", "dev", "local", "test", "demo", " Production "} {
		if err := ValidateEnvironment(ok); err != nil {
			t.Fatalf("ValidateEnvironment(%q) = %v, want nil", ok, err)
		}
	}
	for _, bad := range []string{"prod", "preprod", "stage", "live", "prd"} {
		err := ValidateEnvironment(bad)
		if err == nil || !strings.Contains(err.Error(), "production") {
			t.Fatalf("ValidateEnvironment(%q) = %v, want an error naming the known values", bad, err)
		}
	}
}
