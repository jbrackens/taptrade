package compliance

import (
	"encoding/json"
	"errors"
	stdhttp "net/http"

	"taptrade/platform/transport/httpx"
)

// RegisterComplianceRoutes registers all compliance-related HTTP handlers
func RegisterComplianceRoutes(
	mux *stdhttp.ServeMux,
	geoService GeoComplianceService,
	kycService KYCService,
) {
	registerGeoComplianceRoutes(mux, geoService)
	registerKYCRoutes(mux, kycService)
}

// Geolocation handlers
func registerGeoComplianceRoutes(mux *stdhttp.ServeMux, service GeoComplianceService) {
	mux.Handle("/api/v1/compliance/geo/verify", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}

		var req struct {
			UserID    string  `json:"userId"`
			Latitude  float64 `json:"latitude"`
			Longitude float64 `json:"longitude"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return httpx.BadRequest("invalid JSON payload", map[string]any{"field": "body"})
		}

		if req.UserID == "" {
			return httpx.BadRequest("userId is required", map[string]any{"field": "userId"})
		}

		result, err := service.VerifyLocation(r.Context(), req.UserID, req.Latitude, req.Longitude)
		if err != nil {
			return mapComplianceError(err)
		}

		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
			"result": result,
		})
	}))

	mux.Handle("/api/v1/compliance/geo/approved-countries", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}

		countries, err := service.GetApprovedCountries(r.Context())
		if err != nil {
			return mapComplianceError(err)
		}

		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
			"countries": countries,
			"total":     len(countries),
		})
	}))

	mux.Handle("/api/v1/compliance/geo/check", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}

		country := r.URL.Query().Get("country")
		state := r.URL.Query().Get("state")
		if country == "" {
			return httpx.BadRequest("country query parameter is required", map[string]any{"field": "country"})
		}

		approved, err := service.IsLocationApproved(r.Context(), country, state)
		if err != nil {
			return mapComplianceError(err)
		}

		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
			"country":  country,
			"state":    state,
			"approved": approved,
		})
	}))
}

// KYC handlers
func registerKYCRoutes(mux *stdhttp.ServeMux, service KYCService) {
	mux.Handle("/api/v1/compliance/kyc/verify", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}

		var req struct {
			UserID    string                 `json:"userId"`
			Documents []VerificationDocument `json:"documents"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return httpx.BadRequest("invalid JSON payload", map[string]any{"field": "body"})
		}

		if req.UserID == "" {
			return httpx.BadRequest("userId is required", map[string]any{"field": "userId"})
		}
		if len(req.Documents) == 0 {
			return httpx.BadRequest("at least one document is required", map[string]any{"field": "documents"})
		}

		uid, err := sessionBoundUserID(r, req.UserID)
		if err != nil {
			return err
		}

		result, err := service.VerifyIdentity(r.Context(), uid, req.Documents)
		if err != nil {
			return mapComplianceError(err)
		}

		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
			"result": result,
		})
	}))

	mux.Handle("/api/v1/compliance/kyc/status", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}

		// D-6 parity / GET-disclosure fix: bind the read to the
		// authenticated session. These reads previously trusted an
		// arbitrary ?userId=, so any authenticated user could read
		// another user's RG/KYC state (deterministic userIDs → trivial
		// enumeration). A mismatched supplied userId is rejected (403);
		// an absent one defaults to the session user.
		userID, err := sessionBoundUserID(r, r.URL.Query().Get("userId"))
		if err != nil {
			return err
		}

		status, err := service.GetVerificationStatus(r.Context(), userID)
		if err != nil {
			return mapComplianceError(err)
		}

		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
			"status": kycStatusPayload(status),
		})
	}))

	mux.Handle("/api/v1/compliance/kyc/submit-document", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodPost {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPost)
		}

		var req struct {
			UserID         string `json:"userId"`
			Type           string `json:"type"`
			DocumentID     string `json:"documentId"`
			IssuingCountry string `json:"issuingCountry"`
			ExpiryDate     string `json:"expiryDate"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return httpx.BadRequest("invalid JSON payload", map[string]any{"field": "body"})
		}

		if req.UserID == "" || req.Type == "" {
			return httpx.BadRequest("userId and type are required", map[string]any{"field": "body"})
		}

		uid, err := sessionBoundUserID(r, req.UserID)
		if err != nil {
			return err
		}

		doc := VerificationDocument{
			UserID:         uid,
			Type:           req.Type,
			DocumentID:     req.DocumentID,
			IssuingCountry: req.IssuingCountry,
			ExpiryDate:     req.ExpiryDate,
		}

		result, err := service.SubmitDocument(r.Context(), uid, doc)
		if err != nil {
			return mapComplianceError(err)
		}

		return httpx.WriteJSON(w, stdhttp.StatusCreated, map[string]any{
			"document": result,
		})
	}))

	mux.Handle("/api/v1/compliance/kyc/documents", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}

		// D-6 parity / GET-disclosure fix: bind the read to the
		// authenticated session. These reads previously trusted an
		// arbitrary ?userId=, so any authenticated user could read
		// another user's RG/KYC state (deterministic userIDs → trivial
		// enumeration). A mismatched supplied userId is rejected (403);
		// an absent one defaults to the session user.
		userID, err := sessionBoundUserID(r, r.URL.Query().Get("userId"))
		if err != nil {
			return err
		}

		documents, err := service.ListDocuments(r.Context(), userID)
		if err != nil {
			return mapComplianceError(err)
		}

		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{
			"userId":    userID,
			"documents": kycDocumentPayloads(documents),
			"total":     len(documents),
		})
	}))
}

// sessionBoundUserID enforces that a KYC operation acts on the session's
// own user: the body/query userId must be empty or equal to it.
func sessionBoundUserID(r *stdhttp.Request, bodyUserID string) (string, error) {
	sessionUID := httpx.UserIDFromContext(r.Context())
	if sessionUID == "" {
		return "", httpx.Forbidden("authentication required")
	}
	if bodyUserID != "" && bodyUserID != sessionUID {
		return "", httpx.Forbidden("cannot access another user's compliance data")
	}
	return sessionUID, nil
}

type responsibleLimitRequest struct {
	UserID       string `json:"userId"`
	Period       string `json:"period"`
	AmountPoints int64  `json:"amountPoints"`
}

func mapComplianceError(err error) error {
	if errors.Is(err, ErrInvalidUserID) {
		return httpx.BadRequest("invalid user id", map[string]any{"field": "userId"})
	}
	if errors.Is(err, ErrInvalidLocation) {
		return httpx.BadRequest("invalid location coordinates", map[string]any{"field": "location"})
	}
	if errors.Is(err, ErrRestrictedLocation) {
		return httpx.Forbidden("gaming not available in this location")
	}
	if errors.Is(err, ErrInvalidDocument) {
		return httpx.BadRequest("invalid document", map[string]any{"field": "document"})
	}
	if errors.Is(err, ErrUserNotVerified) {
		return httpx.Forbidden("user identity not verified")
	}
	return httpx.Internal("compliance check failed", err)
}
