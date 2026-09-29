package compliance

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"
)

type GeoSandboxConfig struct {
	Enabled bool
	Country string
	State   string
	City    string
}

// MockGeoComplianceService is an in-memory mock geo compliance service
type MockGeoComplianceService struct {
	mu                sync.RWMutex
	approvedCountries map[string]bool
	locationHistory   map[string][]*LocationResult
	sandboxConfig     GeoSandboxConfig
}

// NewMockGeoComplianceService creates a new mock geo compliance service
func NewMockGeoComplianceService() *MockGeoComplianceService {
	return NewMockGeoComplianceServiceWithConfig(defaultApprovedCountries(), GeoSandboxConfig{})
}

func NewMockGeoComplianceServiceFromEnv() *MockGeoComplianceService {
	return NewMockGeoComplianceServiceWithConfig(
		parseApprovedCountriesEnv(os.Getenv("COMPLIANCE_GEO_APPROVED_COUNTRIES")),
		GeoSandboxConfig{
			Enabled: parseBoolEnv(os.Getenv("COMPLIANCE_GEO_SANDBOX_MODE")),
			Country: strings.ToUpper(strings.TrimSpace(defaultStringEnv(os.Getenv("COMPLIANCE_GEO_SANDBOX_COUNTRY"), "US"))),
			State:   strings.TrimSpace(os.Getenv("COMPLIANCE_GEO_SANDBOX_STATE")),
			City:    strings.TrimSpace(defaultStringEnv(os.Getenv("COMPLIANCE_GEO_SANDBOX_CITY"), "Sandbox City")),
		},
	)
}

func NewMockGeoComplianceServiceWithConfig(approvedCountries map[string]bool, sandboxConfig GeoSandboxConfig) *MockGeoComplianceService {
	if len(approvedCountries) == 0 {
		approvedCountries = defaultApprovedCountries()
	}
	if sandboxConfig.Country == "" {
		sandboxConfig.Country = "US"
	}
	return &MockGeoComplianceService{
		approvedCountries: approvedCountries,
		locationHistory:   make(map[string][]*LocationResult),
		sandboxConfig:     sandboxConfig,
	}
}

func (m *MockGeoComplianceService) VerifyLocation(ctx context.Context, userID string, latitude float64, longitude float64) (*LocationResult, error) {
	if userID == "" {
		return nil, ErrInvalidUserID
	}
	if latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 {
		return nil, ErrInvalidLocation
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	if m.sandboxConfig.Enabled {
		result := &LocationResult{
			UserID:    userID,
			Latitude:  latitude,
			Longitude: longitude,
			Status:    "approved",
			Message:   "Location approved in sandbox mode",
			Country:   m.sandboxConfig.Country,
			State:     m.sandboxConfig.State,
			City:      m.sandboxConfig.City,
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		}
		m.locationHistory[userID] = append(m.locationHistory[userID], result)
		return result, nil
	}

	// Simple mock: determine country by coordinates
	country := m.getCountryFromCoords(latitude, longitude)
	status := "approved"
	message := "Location approved for gaming"

	if !m.approvedCountries[country] {
		status = "declined"
		message = "Gaming not available in this location"
	}

	result := &LocationResult{
		UserID:    userID,
		Latitude:  latitude,
		Longitude: longitude,
		Status:    status,
		Message:   message,
		Country:   country,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}

	m.locationHistory[userID] = append(m.locationHistory[userID], result)
	return result, nil
}

func (m *MockGeoComplianceService) GetApprovedCountries(ctx context.Context) ([]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	countries := make([]string, 0, len(m.approvedCountries))
	for country := range m.approvedCountries {
		countries = append(countries, country)
	}
	return countries, nil
}

func (m *MockGeoComplianceService) IsLocationApproved(ctx context.Context, country string, state string) (bool, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.sandboxConfig.Enabled {
		return true, nil
	}

	approved, found := m.approvedCountries[country]
	return approved && found, nil
}

func defaultApprovedCountries() map[string]bool {
	return map[string]bool{
		"US": true,
		"CA": true,
		"GB": true,
		"IE": true,
		"AU": true,
		"NZ": true,
	}
}

func parseApprovedCountriesEnv(raw string) map[string]bool {
	countries := map[string]bool{}
	for _, token := range strings.Split(raw, ",") {
		country := strings.ToUpper(strings.TrimSpace(token))
		if country != "" {
			countries[country] = true
		}
	}
	if len(countries) == 0 {
		return defaultApprovedCountries()
	}
	return countries
}

func parseBoolEnv(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func defaultStringEnv(raw string, fallback string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return fallback
	}
	return value
}

func (m *MockGeoComplianceService) getCountryFromCoords(lat float64, lng float64) string {
	// Simple mock mapping based on rough coordinates
	if lat > 25 && lat < 50 && lng > -130 && lng < -60 {
		return "US"
	}
	if lat > 40 && lat < 60 && lng > -140 && lng < -50 {
		return "CA"
	}
	if lat > 50 && lat < 60 && lng > -10 && lng < 5 {
		return "GB"
	}
	if lat > 51 && lat < 56 && lng > -12 && lng < -5 {
		return "IE"
	}
	if lat < -10 && lat > -45 && lng > 110 && lng < 160 {
		return "AU"
	}
	if lat < -30 && lat > -50 && lng > 160 && lng < 180 {
		return "NZ"
	}
	return "XX" // Unknown country
}

// MockKYCService is an in-memory mock KYC service
type MockKYCService struct {
	mu        sync.RWMutex
	statuses  map[string]*KYCStatus
	documents map[string][]VerificationDocument
	docSeq    int64
}

// NewMockKYCService creates a new mock KYC service
func NewMockKYCService() *MockKYCService {
	return &MockKYCService{
		statuses:  make(map[string]*KYCStatus),
		documents: make(map[string][]VerificationDocument),
	}
}

func (m *MockKYCService) VerifyIdentity(ctx context.Context, userID string, docs []VerificationDocument) (*KYCResult, error) {
	if userID == "" {
		return nil, ErrInvalidUserID
	}
	if len(docs) == 0 {
		return nil, ErrInvalidDocument
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC()
	expiresAt := now.AddDate(2, 0, 0) // 2 years from now

	result := &KYCResult{
		UserID:           userID,
		Status:           "approved",
		VerificationType: "document",
		RiskLevel:        "low",
		Message:          "Identity verified",
		VerifiedAt:       now.Format(time.RFC3339),
		ExpiresAt:        expiresAt.Format(time.RFC3339),
		DocumentType:     docs[0].Type,
	}

	// Update status
	status := &KYCStatus{
		UserID:             userID,
		Status:             "approved",
		RiskLevel:          "low",
		LastVerifiedAt:     now.Format(time.RFC3339),
		ExpiresAt:          expiresAt.Format(time.RFC3339),
		DocumentsSubmitted: make([]string, 0),
	}

	for _, doc := range docs {
		doc.Status = "approved"
		doc.VerifiedAt = now.Format(time.RFC3339)
		m.documents[userID] = append(m.documents[userID], doc)
		status.DocumentsSubmitted = append(status.DocumentsSubmitted, doc.Type)
	}

	m.statuses[userID] = status
	return result, nil
}

func (m *MockKYCService) GetVerificationStatus(ctx context.Context, userID string) (*KYCStatus, error) {
	if userID == "" {
		return nil, ErrInvalidUserID
	}

	m.mu.RLock()
	defer m.mu.RUnlock()

	status, found := m.statuses[userID]
	if !found {
		return &KYCStatus{
			UserID:    userID,
			Status:    "unverified",
			RiskLevel: "unknown",
		}, nil
	}

	// Return a copy
	copy := *status
	return &copy, nil
}

func (m *MockKYCService) SubmitDocument(ctx context.Context, userID string, doc VerificationDocument) (*VerificationDocument, error) {
	if userID == "" {
		return nil, ErrInvalidUserID
	}
	if doc.Type == "" {
		return nil, ErrInvalidDocument
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	m.docSeq++
	doc.ID = fmt.Sprintf("doc:%d", m.docSeq)
	doc.UserID = userID
	doc.SubmittedAt = time.Now().UTC().Format(time.RFC3339)
	doc.Status = "submitted"

	m.documents[userID] = append(m.documents[userID], doc)
	return &doc, nil
}

func (m *MockKYCService) ListDocuments(ctx context.Context, userID string) ([]VerificationDocument, error) {
	if userID == "" {
		return nil, ErrInvalidUserID
	}

	m.mu.RLock()
	defer m.mu.RUnlock()

	docs, found := m.documents[userID]
	if !found {
		return []VerificationDocument{}, nil
	}

	// Return a copy
	result := make([]VerificationDocument, len(docs))
	copy(result, docs)
	return result, nil
}
