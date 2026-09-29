package main

import (
	"bytes"
	"fmt"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"taptrade/platform/transport/httpx"
)

// TD-055: httpx.Chain makes the first middleware the outermost. Requests that
// Auth, CSRF or the rate limiter reject — and handler panics — must still be
// access-logged and counted.
func TestGatewayMiddlewaresLogAndCountRejectionsAndPanics(t *testing.T) {
	var logBuf bytes.Buffer
	registry := httpx.NewMetricsRegistry()
	limited := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/api/v1/markets/limited" {
				httpx.WriteError(w, r, httpx.TooManyRequests("slow down"))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
	mws := gatewayMiddlewares(gatewayMiddlewareDeps{
		authEnabled:      true,
		authServiceURL:   "http://127.0.0.1:1",
		publicPrefixes:   gatewayPublicPrefixes(),
		csrfSkipPrefixes: gatewayCSRFSkipPrefixes(),
		cors:             httpx.CORS([]string{"http://localhost:3010"}),
		rateLimit:        limited,
		metrics:          registry,
		logger:           log.New(&logBuf, "", 0),
	})

	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/markets/panics", func(http.ResponseWriter, *http.Request) {
		panic("boom")
	})
	mux.HandleFunc("/api/v1/orders", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := httpx.Chain(mux, mws...)

	cases := []struct {
		method, path string
		want         int
	}{
		{http.MethodGet, "/api/v1/orders", http.StatusUnauthorized},                // Auth: no session
		{http.MethodGet, "/api/v1/markets/limited", http.StatusTooManyRequests},    // rate limiter
		{http.MethodGet, "/api/v1/markets/panics", http.StatusInternalServerError}, // Recovery
	}
	for _, tc := range cases {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(tc.method, tc.path, nil))
		if rec.Code != tc.want {
			t.Fatalf("%s %s = %d, want %d (%s)", tc.method, tc.path, rec.Code, tc.want, rec.Body.String())
		}
		if rec.Header().Get("X-Request-ID") == "" {
			t.Fatalf("%s: response has no X-Request-ID", tc.path)
		}
		if rec.Header().Get("X-Content-Type-Options") == "" {
			t.Fatalf("%s: security headers missing on a %d", tc.path, rec.Code)
		}
		if !strings.Contains(logBuf.String(), fmt.Sprintf("path=%s status=%d", tc.path, tc.want)) {
			t.Fatalf("%s: not access-logged:\n%s", tc.path, logBuf.String())
		}
		counted := false
		for _, m := range registry.Snapshot() {
			if m.Path == tc.path && m.StatusCode == tc.want && m.Count > 0 {
				counted = true
			}
		}
		if !counted {
			t.Fatalf("%s: status %d not counted in metrics: %+v", tc.path, tc.want, registry.Snapshot())
		}
	}
}
