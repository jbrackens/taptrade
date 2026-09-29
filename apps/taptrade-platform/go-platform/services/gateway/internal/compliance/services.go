package compliance

import (
	"context"
	"errors"
)

var (
	ErrInvalidUserID      = errors.New("invalid user id")
	ErrInvalidLocation    = errors.New("invalid location")
	ErrRestrictedLocation = errors.New("restricted location")
	ErrInvalidDocument    = errors.New("invalid document")
	ErrUserNotVerified    = errors.New("user not verified")
)

// GeoComplianceService defines geolocation verification operations
type GeoComplianceService interface {
	// VerifyLocation verifies a user's location
	VerifyLocation(ctx context.Context, userID string, latitude float64, longitude float64) (*LocationResult, error)

	// GetApprovedCountries returns list of countries where gaming is approved
	GetApprovedCountries(ctx context.Context) ([]string, error)

	// IsLocationApproved checks if a specific location is approved
	IsLocationApproved(ctx context.Context, country string, state string) (bool, error)
}

// KYCService defines Know Your Customer verification operations
type KYCService interface {
	// VerifyIdentity verifies a user's identity with provided documents
	VerifyIdentity(ctx context.Context, userID string, docs []VerificationDocument) (*KYCResult, error)

	// GetVerificationStatus returns the current KYC status
	GetVerificationStatus(ctx context.Context, userID string) (*KYCStatus, error)

	// SubmitDocument submits a document for KYC verification
	SubmitDocument(ctx context.Context, userID string, doc VerificationDocument) (*VerificationDocument, error)

	// ListDocuments lists all documents submitted by a user
	ListDocuments(ctx context.Context, userID string) ([]VerificationDocument, error)
}
