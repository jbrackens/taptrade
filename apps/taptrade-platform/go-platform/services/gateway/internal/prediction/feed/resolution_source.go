package feed

import (
	"context"
	"encoding/json"
	"sync"
	"time"
)

// ADR-0003: resolution-source health + the corroboration seam.
//
// The Tap Trade launch policy is admin/manual attestation only. Automated
// adapters are compatibility seams for legacy or future non-launch markets and
// must be explicitly enabled before registration. When a source is enabled,
// the AutoSettler tracks per-source health: this makes a degraded source
// VISIBLE (consecutive failures, last error) and gives ops an alert hook,
// instead of markets silently stalling in "closed". When a source is failing
// the worker simply does not propose — the market stays closed for manual
// admin resolution, which is the intended fallback (ADR-0003 #4).

// Corroborator is the OPTIONAL future seam for >=2-source agreement (ADR-0003
// #3). No adapter implements it yet: the confirmed design fork is single-source
// propose + challenge window, NOT mandatory corroboration. When a money-bearing
// category later needs provable agreement, an adapter can implement Corroborate
// to cross-check a primary Result against an independent source before the
// AutoSettler proposes. Wiring it into the worker is intentionally deferred.
type Corroborator interface {
	Corroborate(ctx context.Context, rule string, params json.RawMessage, primary *Result) (*Result, error)
}

// DefaultUnhealthyThreshold is the number of consecutive fetch failures after
// which a source is reported unhealthy (and an alert fires once).
const DefaultUnhealthyThreshold = 3

// SourceHealth is a point-in-time health snapshot for one resolution source.
type SourceHealth struct {
	Source              string     `json:"source"`
	Healthy             bool       `json:"healthy"`
	ConsecutiveFailures int        `json:"consecutiveFailures"`
	TotalSuccesses      int64      `json:"totalSuccesses"`
	TotalFailures       int64      `json:"totalFailures"`
	LastSuccessAt       *time.Time `json:"lastSuccessAt,omitempty"`
	LastFailureAt       *time.Time `json:"lastFailureAt,omitempty"`
	LastError           string     `json:"lastError,omitempty"`
}

// HealthTracker records per-source fetch outcomes for the AutoSettler. Safe for
// concurrent use (the worker ticks on one goroutine, but the admin health
// endpoint reads concurrently).
type HealthTracker struct {
	mu        sync.Mutex
	threshold int
	sources   map[string]*sourceState
}

type sourceState struct {
	consecutiveFailures int
	totalSuccesses      int64
	totalFailures       int64
	lastSuccessAt       *time.Time
	lastFailureAt       *time.Time
	lastError           string
	alerted             bool // dedupe: alert once per unhealthy episode
}

// NewHealthTracker returns a tracker using DefaultUnhealthyThreshold.
func NewHealthTracker() *HealthTracker {
	return &HealthTracker{threshold: DefaultUnhealthyThreshold, sources: map[string]*sourceState{}}
}

func (t *HealthTracker) state(source string) *sourceState {
	st, ok := t.sources[source]
	if !ok {
		st = &sourceState{}
		t.sources[source] = st
	}
	return st
}

// RecordSuccess marks a clean fetch, clearing the failure streak. It returns
// true if the source had been unhealthy and has now recovered (so the caller
// can log a recovery line).
func (t *HealthTracker) RecordSuccess(source string) (recovered bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	st := t.state(source)
	recovered = st.alerted
	now := time.Now().UTC()
	st.consecutiveFailures = 0
	st.totalSuccesses++
	st.lastSuccessAt = &now
	st.lastError = ""
	st.alerted = false
	return recovered
}

// RecordFailure marks a failed fetch. It returns true exactly once per
// unhealthy episode — when the consecutive-failure streak first reaches the
// threshold — so the caller can fire a single alert rather than per-tick spam.
func (t *HealthTracker) RecordFailure(source string, err error) (alert bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	st := t.state(source)
	now := time.Now().UTC()
	st.consecutiveFailures++
	st.totalFailures++
	st.lastFailureAt = &now
	if err != nil {
		st.lastError = err.Error()
	}
	if st.consecutiveFailures >= t.threshold && !st.alerted {
		st.alerted = true
		return true
	}
	return false
}

// Snapshot returns the current health of every source seen so far.
func (t *HealthTracker) Snapshot() []SourceHealth {
	t.mu.Lock()
	defer t.mu.Unlock()
	out := make([]SourceHealth, 0, len(t.sources))
	for name, st := range t.sources {
		out = append(out, SourceHealth{
			Source:              name,
			Healthy:             st.consecutiveFailures < t.threshold,
			ConsecutiveFailures: st.consecutiveFailures,
			TotalSuccesses:      st.totalSuccesses,
			TotalFailures:       st.totalFailures,
			LastSuccessAt:       st.lastSuccessAt,
			LastFailureAt:       st.lastFailureAt,
			LastError:           st.lastError,
		})
	}
	return out
}
