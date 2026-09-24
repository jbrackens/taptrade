package prediction

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"strings"
)

// maxCoverImageURLLength bounds the stored cover reference; real paths and
// CDN URLs are far shorter.
const maxCoverImageURLLength = 2048

// ErrEventNotFound is returned when an event id does not exist.
var ErrEventNotFound = errors.New("event not found")

// normalizeCoverImageURL validates an event cover reference. It accepts a
// site-relative path under /images/ (the player app serves those files) or
// an absolute https URL. Empty means "no cover". Anything else — http,
// javascript:, data:, protocol-relative, or a path escaping /images/ — is
// rejected so a curator cannot inject script or mixed content.
func normalizeCoverImageURL(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", nil
	}
	if len(value) > maxCoverImageURLLength {
		return "", fmt.Errorf("coverImageUrl is too long")
	}
	if strings.HasPrefix(value, "/") {
		if strings.HasPrefix(value, "//") || !strings.HasPrefix(value, "/images/") ||
			strings.Contains(value, "..") || strings.ContainsAny(value, "\\\n\r\t ") {
			return "", fmt.Errorf("coverImageUrl path must live under /images/")
		}
		return value, nil
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
		return "", fmt.Errorf("coverImageUrl must be an https URL or a /images/ path")
	}
	return parsed.String(), nil
}

// UpdateEventPresentation curates an event's home-page presentation
// (featured flag, cover photo). It never touches lifecycle, pricing or
// settlement state.
func (s *Service) UpdateEventPresentation(ctx context.Context, id string, req UpdateEventPresentationRequest) (*Event, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, fmt.Errorf("event id is required")
	}
	if req.Featured == nil && req.CoverImageURL == nil {
		return nil, fmt.Errorf("nothing to update: send featured and/or coverImageUrl")
	}
	var cover *string
	if req.CoverImageURL != nil {
		normalized, err := normalizeCoverImageURL(*req.CoverImageURL)
		if err != nil {
			return nil, err
		}
		cover = &normalized
	}
	if err := s.repo.UpdateEventPresentation(ctx, id, req.Featured, cover); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrEventNotFound
		}
		return nil, fmt.Errorf("update event presentation: %w", err)
	}
	return s.repo.GetEvent(ctx, id)
}
