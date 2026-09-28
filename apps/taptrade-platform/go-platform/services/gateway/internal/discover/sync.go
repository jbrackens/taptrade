package discover

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"strings"
	"time"
)

// upstreamNames are source-venue brand names that must never appear in any
// user-visible field. Some upstream markets are literally *about* the
// venue ("Will Manifold be mentioned in the Zizian docuseries?") or self-tag
// in their title ("WTI Crude Oil (Polymarket)"). Drop those rows at ingest;
// the spec-required eyeball check ("no 'polymarket'/'kalshi'/'manifold' in
// the response body") would otherwise fail on legitimate content leakage.
var upstreamNames = []string{"polymarket", "kalshi", "manifold"}

func mentionsUpstream(s string) bool {
	if s == "" {
		return false
	}
	low := strings.ToLower(s)
	for _, n := range upstreamNames {
		if strings.Contains(low, n) {
			return true
		}
	}
	return false
}

// SyncResult is the per-run summary the runner prints to stderr.
type SyncResult struct {
	FetchedPolymarket   int
	FetchedKalshi       int
	FetchedManifold     int
	BeforeDedupe        int
	AfterDedupe         int
	Created             int
	Updated             int
	ImagesRehosted      int
	ImagesFailed        int
	CoversResolved      int
	ImagesDroppedShared int
	MarketImagesAligned int
	RemovedExpired      int
	FetchErrors         []error
}

// Sync runs the full pipeline once: fetch all three sources, dedupe by title,
// rehost any Polymarket images, and upsert by external_hash. Returns the
// deduped market list as the third value so the caller can chain into
// `Promote()` without re-fetching.
//
// Logging policy (important): every slog/log line in this package goes to
// the server-side stderr only. The strings "polymarket", "kalshi", and
// "manifold" are allowed there — but never in any field that could surface
// in a user-visible toast, status JSON, or Sentry tag exposed to the
// frontend. Phase 1 has no such surface; phase 2 must enforce this when we
// add error reporting.
func Sync(ctx context.Context, repo *Repository, rehoster *ImageRehoster,
	limits map[string]int) (SyncResult, []Market, error) {

	// The request budget is per RUN (maxRequestsPerSourcePerRun), not per
	// process. This layer was written for the one-shot sync-markets CLI,
	// where process exit reset it implicitly; the in-process hourly worker
	// (startHourlyMarketSyncWorker) reuses the process-global budget, so
	// without this reset kalshi exhausts its budget at boot and every
	// source is dead within hours — each later run then fails in
	// milliseconds with "budget exhausted" and the catalog silently stops
	// updating (observed on the demo box, 2026-07-07).
	resetBudget()
	var covers *CoverResolver
	if rehoster != nil && !strings.EqualFold(strings.TrimSpace(os.Getenv("MARKET_COVER_RESOLVER")), "false") {
		covers = NewCoverResolver(rehoster, coverStoreOrNil(repo))
		covers.ResetBudget()
	}

	res := SyncResult{}
	all := make([]Market, 0, 500)
	enabledSources := 0
	for _, src := range []string{"polymarket", "kalshi", "manifold"} {
		if limits[src] > 0 {
			enabledSources++
		}
	}

	if l := limits["polymarket"]; l > 0 {
		ms, err := FetchPolymarket(l)
		if err != nil {
			res.FetchErrors = append(res.FetchErrors, err)
			slog.Warn("discover fetch failed", "src", "polymarket", "err", err)
		}
		res.FetchedPolymarket = len(ms)
		all = append(all, ms...)
	}
	if l := limits["kalshi"]; l > 0 {
		// Kalshi's listings are read as a rotating scan: continue from the
		// cursors the last run saved, and save where this one stopped, even
		// when the slice yielded nothing usable.
		scan := loadKalshiScan(ctx, repo)
		ms, next, err := FetchKalshiFrom(l, scan)
		if err != nil {
			res.FetchErrors = append(res.FetchErrors, err)
			slog.Warn("discover fetch failed", "src", "kalshi", "err", err)
		}
		saveKalshiScan(ctx, repo, next)
		res.FetchedKalshi = len(ms)
		all = append(all, ms...)
	}
	if l := limits["manifold"]; l > 0 {
		ms, err := FetchManifold(l)
		if err != nil {
			res.FetchErrors = append(res.FetchErrors, err)
			slog.Warn("discover fetch failed", "src", "manifold", "err", err)
		}
		res.FetchedManifold = len(ms)
		all = append(all, ms...)
	}

	// No fresh upstream signal → no mutations. Without this, a run where
	// every enabled fetcher failed (e.g. the 2026-07-07 budget-exhaustion
	// incident) still executed the stale-import janitor and image sweeps
	// against a catalog nothing refreshed — every failed hourly run kept
	// advancing expiry blind, mass-voiding imports over time.
	if enabledSources == 0 {
		return res, nil, nil
	}
	if len(all) == 0 && len(res.FetchErrors) == enabledSources {
		return res, nil, errors.New("all enabled fetchers failed")
	}

	// Content filter — drop any market whose title or description names a
	// source venue, before dedupe. See upstreamNames above for rationale.
	filtered := make([]Market, 0, len(all))
	for _, m := range all {
		if mentionsUpstream(m.Title) || mentionsUpstream(m.Description) {
			continue
		}
		filtered = append(filtered, m)
	}
	all = filtered

	res.BeforeDedupe = len(all)
	deduped := Dedupe(all, 0.85)
	res.AfterDedupe = len(deduped)

	for _, m := range deduped {
		hash := HashKey(m.Source, m.ExternalID)
		ur, err := repo.Reserve(ctx, hash)
		if err != nil {
			slog.Warn("discover reserve failed", "src", m.Source, "err", err)
			continue
		}

		var imagePath *string
		if rehoster != nil && m.ImageURL != "" {
			path, err := rehoster.Rehost(ur.ID, m.ImageURL)
			if err != nil {
				res.ImagesFailed++
				slog.Warn("discover image rehost failed", "src", m.Source,
					"row_id", ur.ID, "err", err)
			} else if path != "" {
				imagePath = &path
				res.ImagesRehosted++
			}
		}

		row := Row{
			ID:                ur.ID,
			ExternalHash:      hash,
			Title:             m.Title,
			Description:       m.Description,
			SourceURL:         m.SourceURL,
			UpstreamStatus:    m.Status,
			UpstreamUpdatedAt: m.UpdatedAt,
			RulesText:         m.RulesText,
			EventGroup:        m.EventGroup,
			EventTitle:        m.EventTitle,
			OutcomeLabel:      m.OutcomeLabel,
			Tags:              m.Tags,
			ImagePath:         imagePath,
			EndTime:           m.EndTime,
			Volume:            m.Volume,
			Volume24h:         m.Volume24h,
			Liquidity:         m.Liquidity,
			Outcomes:          m.Outcomes,
			Prices:            m.Prices,
		}
		if err := repo.Update(ctx, ur.ID, row); err != nil {
			slog.Warn("discover update failed", "src", m.Source, "row_id", ur.ID, "err", err)
			continue
		}
		if ur.Created {
			res.Created++
		} else {
			res.Updated++
		}
		// No image from the source: find one in an open repository (or draw
		// a matchup tile), once, and remember the answer.
		if imagePath == nil && covers != nil {
			if needs, err := repo.NeedsCover(ctx, ur.ID); err == nil && needs {
				resolveCover(ctx, repo, covers, ur.ID, m, Classify(m), &res)
			}
		}
	}

	staleHashes, err := repo.StaleImportedHashes(ctx, timeNowUTC())
	if err != nil {
		slog.Warn("discover stale cleanup scan failed", "err", err)
	} else if len(staleHashes) > 0 {
		removed, err := repo.MarkMissing(ctx, staleHashes)
		if err != nil {
			slog.Warn("discover stale cleanup failed", "err", err)
		} else {
			res.RemovedExpired = removed
		}
	}

	// Thumbnail hygiene, in two passes. First drop covers that upstream
	// reuses across unrelated markets (needs the rehost folder to hash file
	// content, so it's skipped when rehosting is disabled). Then align every
	// promoted IMP-* market's image_path with its imported row, which both
	// propagates the drops and corrects historical mismatches.
	if rehoster != nil {
		dropped, err := dropSharedCoverImages(ctx, repo, rehoster)
		if err != nil {
			slog.Warn("discover shared-cover sweep failed", "err", err)
		} else {
			res.ImagesDroppedShared = dropped
		}
	}
	// Backfill: bare open imports the board shows, whichever run fetched
	// them — rows the sweep just stripped of venue branding included.
	if covers != nil {
		res.CoversResolved += backfillCovers(ctx, repo, covers, intEnvOr("COVER_BACKFILL_PER_RUN", defaultBackfillRowsPerRun))
	}

	aligned, err := repo.AlignPromotedMarketImages(ctx)
	if err != nil {
		slog.Warn("discover promoted image align failed", "err", err)
	} else {
		res.MarketImagesAligned = aligned
	}

	return res, deduped, nil
}

// dropSharedCoverImages clears thumbnails whose file content is shared by
// imported markets that don't belong to one upstream event. Sources reuse
// series/venue branding this way — one game-cover image stamped on dozens of
// unrelated questions — and a wrong cover is worse than no cover.
func dropSharedCoverImages(ctx context.Context, repo *Repository, rehoster *ImageRehoster) (int, error) {
	rows, err := repo.ListImageRows(ctx)
	if err != nil {
		return 0, err
	}
	ids := sharedCoverImageRowIDs(rows, rehoster.HashHostedImage)
	return repo.ClearImagePaths(ctx, ids)
}

// sharedCoverImageRowIDs is the pure decision core of the shared-cover sweep:
// group rows by image content hash; a hash spanning more than one upstream
// series is generic venue branding, not art for any single market, so every
// row carrying it loses the image. Rows sharing one series keep their cover:
// an event's own image on that event's markets, or a league's art on that
// league's games (Polymarket stamps one NFL image on every NFL game and one
// ATP image on every match — the 2026-09-27 sweep dropped 151 of 150 fresh
// covers for exactly that). A row without an event group counts as its own
// series. Rows whose file can't be hashed are left untouched.
func sharedCoverImageRowIDs(rows []ImportedImageRow, hashOf func(string) (string, bool)) []string {
	type group struct {
		ids       []string
		eventKeys map[string]struct{}
	}
	groups := map[string]*group{}
	for _, row := range rows {
		hash, ok := hashOf(row.ImagePath)
		if !ok {
			continue
		}
		g := groups[hash]
		if g == nil {
			g = &group{eventKeys: map[string]struct{}{}}
			groups[hash] = g
		}
		g.ids = append(g.ids, row.ID)
		eventKey := coverSeriesKey(row.EventGroup)
		if eventKey == "" {
			eventKey = "row:" + row.ID
		}
		g.eventKeys[eventKey] = struct{}{}
	}

	var out []string
	for _, g := range groups {
		if len(g.eventKeys) > 1 {
			out = append(out, g.ids...)
		}
	}
	return out
}

// coverSeriesKey reduces an upstream event group to its series: the leading
// token of a Polymarket event slug ("nfl-kc-mia-2026-09-27" → "nfl") or a
// Kalshi event ticker ("KXNFLGAME-25SEP27KCMIA" → "kxnflgame").
func coverSeriesKey(eventGroup string) string {
	g := strings.ToLower(strings.TrimSpace(eventGroup))
	if i := strings.IndexAny(g, "-_"); i > 0 {
		return g[:i]
	}
	return g
}

var timeNowUTC = func() time.Time { return time.Now().UTC() }

const (
	kalshiCursorSource  = "kalshi"
	kalshiCursorOpen    = "events:open"
	kalshiCursorSettled = "events:settled"
)

func loadKalshiScan(ctx context.Context, repo *Repository) KalshiScan {
	if repo == nil {
		return KalshiScan{}
	}
	var scan KalshiScan
	var err error
	if scan.Open, err = repo.LoadCursor(ctx, kalshiCursorSource, kalshiCursorOpen); err != nil {
		slog.Warn("discover cursor load failed; starting from the top", "src", "kalshi", "err", err)
		return KalshiScan{}
	}
	if scan.Settled, err = repo.LoadCursor(ctx, kalshiCursorSource, kalshiCursorSettled); err != nil {
		slog.Warn("discover cursor load failed; starting from the top", "src", "kalshi", "err", err)
		return KalshiScan{}
	}
	return scan
}

func saveKalshiScan(ctx context.Context, repo *Repository, scan KalshiScan) {
	if repo == nil {
		return
	}
	for listing, cursor := range map[string]string{kalshiCursorOpen: scan.Open, kalshiCursorSettled: scan.Settled} {
		if err := repo.SaveCursor(ctx, kalshiCursorSource, listing, cursor); err != nil {
			slog.Warn("discover cursor save failed", "src", "kalshi", "listing", listing, "err", err)
		}
	}
}

// coverStoreOrNil keeps a nil *Repository from becoming a non-nil interface.
func coverStoreOrNil(repo *Repository) CoverStore {
	if repo == nil {
		return nil
	}
	return repo
}

// resolveCover finds and stores a cover for one imported row, recording the
// attempt when nothing was found so the backfill moves on.
func resolveCover(ctx context.Context, repo *Repository, covers *CoverResolver, id string, m Market, category string, res *SyncResult) bool {
	meta, ok, complete := covers.ResolveChecked(ctx, id, m, category)
	if ok {
		if err := repo.SetImage(ctx, id, meta); err != nil {
			slog.Warn("discover cover save failed", "row_id", id, "err", err)
			return false
		}
		if res != nil {
			res.CoversResolved++
		}
		return true
	}
	if complete {
		if err := repo.MarkCoverChecked(ctx, id); err != nil {
			slog.Warn("discover cover check save failed", "row_id", id, "err", err)
		}
	}
	return false
}

// backfillCovers resolves covers for up to limit bare open imports, and
// re-resolves resolver covers marked for another look, stopping when the
// run's lookup budget is spent. Returns how many covers it wrote.
func backfillCovers(ctx context.Context, repo *Repository, covers *CoverResolver, limit int) int {
	rows, err := repo.ListBareOpenImports(ctx, limit)
	if err != nil {
		slog.Warn("discover cover backfill list failed", "err", err)
		return 0
	}
	covers.StartBackfill()
	filled, cleared := 0, 0
	for _, b := range rows {
		if ctx.Err() != nil || covers.Exhausted() {
			break
		}
		m := Market{Title: b.Title, EventTitle: b.EventTitle, Description: b.Description}
		if !b.HasCover {
			if resolveCover(ctx, repo, covers, b.ID, m, b.CategorySlug, nil) {
				filled++
			}
			continue
		}
		meta, ok, complete := covers.ReplaceChecked(ctx, b.ID, m, b.CategorySlug)
		switch {
		case ok:
			if err := repo.SetImage(ctx, b.ID, meta); err != nil {
				slog.Warn("discover cover save failed", "row_id", b.ID, "err", err)
				continue
			}
			covers.rehoster.RemoveCoversExcept(b.ID, meta.Path)
			filled++
		case complete:
			if err := repo.ClearResolverCover(ctx, b.ID); err != nil {
				slog.Warn("discover cover clear failed", "row_id", b.ID, "err", err)
				continue
			}
			covers.rehoster.RemoveCoversExcept(b.ID, "")
			cleared++
		}
	}
	if filled > 0 || cleared > 0 || len(rows) > 0 {
		slog.Info("discover cover backfill", "listed", len(rows), "filled", filled, "cleared", cleared)
	}
	return filled
}
