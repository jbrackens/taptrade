package store

// Jurisdiction integration for point-pack purchases.
//
// Owner decision (2026-07-12): checkout is guarded by the same jurisdiction
// gate as other value-in surfaces (compliance.SurfaceDeposit). The seam is a
// package-level variable injected by internal/http/handlers.go at route
// registration; nil is a no-op, so the package stays independently testable
// and a bare dev boot works without the compliance stack.
//
// The responsible-gambling purchase limits that used to sit here were
// sportsbook residue and were removed on 2026-09-29.

import "taptrade/gateway/internal/compliance"

// ComplianceGate guards checkout creation on the jurisdiction/KYC gates
// owned by the HTTP layer. When nil, no gate applies (dev/harness mode).
var ComplianceGate compliance.GateFunc
