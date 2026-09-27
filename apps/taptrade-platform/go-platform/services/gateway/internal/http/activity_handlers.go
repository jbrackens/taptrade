package http

import (
	stdhttp "net/http"
	"strconv"

	"taptrade/gateway/internal/prediction"
	"taptrade/platform/transport/httpx"
)

// GET /api/v1/activity/recent — proof of life for the board: the latest
// real fills and the day's biggest movers. Public; empty lists when the
// exchange is quiet, never a substitute signal.
func registerActivityRoutes(mux *stdhttp.ServeMux, repo *prediction.SQLRepository) {
	if mux == nil || repo == nil {
		return
	}
	mux.Handle("/api/v1/activity/recent", httpx.Handle(func(w stdhttp.ResponseWriter, r *stdhttp.Request) error {
		if r.Method != stdhttp.MethodGet {
			return httpx.MethodNotAllowed(r.Method, stdhttp.MethodGet)
		}
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		trades, err := repo.ListRecentActivity(r.Context(), limit)
		if err != nil {
			return httpx.Internal("failed to list recent activity", err)
		}
		movers, err := repo.ListMovers24h(r.Context(), 8)
		if err != nil {
			return httpx.Internal("failed to list movers", err)
		}
		w.Header().Set("Cache-Control", "public, max-age=15")
		return httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{"trades": trades, "movers": movers})
	}))
}
