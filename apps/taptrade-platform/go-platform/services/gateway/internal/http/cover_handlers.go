package http

import (
	"database/sql"
	"encoding/json"
	stdhttp "net/http"
	"net/url"
	"strconv"
	"strings"

	"taptrade/gateway/internal/discover"
	"taptrade/platform/transport/httpx"
)

// Cover routes (2026-09-27): the public credits page for openly licensed
// thumbnails, and the back-office queue that reviews, replaces or removes
// what the cover resolver chose.
func registerCoverRoutes(mux *stdhttp.ServeMux, db *sql.DB) {
	if mux == nil || db == nil {
		return
	}
	repo := discover.NewRepository(db)

	mux.Handle("/api/v1/attributions", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		items, err := repo.ListAttributions(r.Context(), limit)
		if err != nil {
			return httpx.Internal("failed to list attributions", err)
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{"data": items})
	}))

	mux.Handle("/api/v1/admin/markets/images", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if err := requireAdminPermission(r, "markets:edit"); err != nil {
			return err
		}
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		items, err := repo.ListResolvedCovers(r.Context(), limit)
		if err != nil {
			return httpx.Internal("failed to list covers", err)
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{"data": items})
	}))

	// PATCH /api/v1/admin/markets/{id}/image  {"imagePath": "/images/... | https://... | \"\"}
	mux.Handle("/api/v1/admin/markets/", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		rest := strings.TrimPrefix(r.URL.Path, "/api/v1/admin/markets/")
		id, ok := strings.CutSuffix(rest, "/image")
		if !ok || id == "" || strings.Contains(id, "/") {
			return httpx.NotFound("route not found")
		}
		if err := requireAdminPermission(r, "markets:edit"); err != nil {
			return err
		}
		if r.Method != stdhttp.MethodPatch {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodPatch)
		}
		var req struct {
			ImagePath string `json:"imagePath"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return httpx.BadRequest("invalid request body", nil)
		}
		path, err := normalizeMarketImagePath(req.ImagePath)
		if err != nil {
			return httpx.BadRequest("imagePath must be an https URL or a /images/ path", map[string]any{"field": "imagePath"})
		}
		found, err := repo.SetManualImage(r.Context(), id, path)
		if err != nil {
			return httpx.Internal("failed to set image", err)
		}
		if !found {
			return httpx.NotFound("market not found")
		}
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{"marketId": id, "imagePath": path})
	}))
}

// normalizeMarketImagePath mirrors the event cover rule: a site-relative
// /images/ path or an https URL; empty removes the image.
func normalizeMarketImagePath(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", nil
	}
	if len(value) > 512 {
		return "", errorString("imagePath is too long")
	}
	if strings.HasPrefix(value, "/") {
		if strings.HasPrefix(value, "//") || !strings.HasPrefix(value, "/images/") ||
			strings.Contains(value, "..") || strings.ContainsAny(value, "\\\n\r\t ") {
			return "", errorString("imagePath must live under /images/")
		}
		return value, nil
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
		return "", errorString("imagePath must be an https URL or a /images/ path")
	}
	return parsed.String(), nil
}

type errorString string

func (e errorString) Error() string { return string(e) }
