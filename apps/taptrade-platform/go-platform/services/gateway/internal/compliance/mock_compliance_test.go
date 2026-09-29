package compliance

import (
	"context"
	"testing"
)

func TestMockGeoComplianceServiceUsesConfiguredApprovedCountries(t *testing.T) {
	t.Setenv("COMPLIANCE_GEO_APPROVED_COUNTRIES", "US,MT")
	t.Setenv("COMPLIANCE_GEO_SANDBOX_MODE", "")

	service := NewMockGeoComplianceServiceFromEnv()

	approved, err := service.IsLocationApproved(context.Background(), "MT", "")
	if err != nil {
		t.Fatalf("IsLocationApproved returned error: %v", err)
	}
	if !approved {
		t.Fatalf("expected MT to be approved from env configuration")
	}
}

func TestMockGeoComplianceServiceSandboxModeApprovesAnyLocation(t *testing.T) {
	t.Setenv("COMPLIANCE_GEO_SANDBOX_MODE", "true")
	t.Setenv("COMPLIANCE_GEO_SANDBOX_COUNTRY", "MT")
	t.Setenv("COMPLIANCE_GEO_SANDBOX_STATE", "MT-LOCAL")
	t.Setenv("COMPLIANCE_GEO_SANDBOX_CITY", "Valletta")

	service := NewMockGeoComplianceServiceFromEnv()

	result, err := service.VerifyLocation(context.Background(), "u-1", 35.8997, 14.5146)
	if err != nil {
		t.Fatalf("VerifyLocation returned error: %v", err)
	}
	if result.Status != "approved" {
		t.Fatalf("expected sandbox result approved, got %s", result.Status)
	}
	if result.Country != "MT" {
		t.Fatalf("expected sandbox country MT, got %s", result.Country)
	}
	if result.State != "MT-LOCAL" {
		t.Fatalf("expected sandbox state MT-LOCAL, got %s", result.State)
	}
	if result.City != "Valletta" {
		t.Fatalf("expected sandbox city Valletta, got %s", result.City)
	}
}
