package discover

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ImageRehoster downloads upstream image URLs and writes them under our own
// path, returning the relative URL the client should see. Phase-1 layout:
//
//	on-disk : <publicRoot>/images/markets/<uuid>.<ext>
//	web URL : /images/markets/<uuid>.<ext>
//
// The folder name "markets" is deliberately generic — it appears in
// devtools and in right-click → "Copy image address." Internal naming like
// "imported/" or "polymarket/" would leak the data origin.
type ImageRehoster struct {
	PublicRoot string // absolute path to the Next.js public/ directory
	client     *http.Client
}

// NewImageRehoster returns a rehoster that writes into publicRoot/images/markets/.
func NewImageRehoster(publicRoot string) *ImageRehoster {
	return &ImageRehoster{
		PublicRoot: publicRoot,
		client:     &http.Client{Timeout: 10 * time.Second},
	}
}

// Rehost downloads the upstream image and writes it under our own UUID. On
// any failure it returns ("", err) — the caller persists the row with a nil
// image_path and continues. Errors are returned for server-side logging
// only; nothing about the upstream host should reach the client.
func (r *ImageRehoster) Rehost(rowID, imageURL string) (string, error) {
	if r == nil || imageURL == "" {
		return "", nil
	}

	dir := filepath.Join(r.PublicRoot, "images", "markets")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("mkdir: %w", err)
	}
	// Every sync re-fetches the same busy markets; a cover already on disk
	// is reused rather than downloaded again (250 covers per run every 15
	// minutes would otherwise hit the upstream CDN for ~6 GB a day).
	if existing, err := filepath.Glob(filepath.Join(dir, rowID+".*")); err == nil && len(existing) > 0 {
		return "/images/markets/" + filepath.Base(existing[0]), nil
	}

	req, err := http.NewRequest(http.MethodGet, imageURL, nil)
	if err != nil {
		return "", fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("User-Agent", "demo-pm-seeder/0.1")

	resp, err := r.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("download: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("status %d", resp.StatusCode)
	}

	ext := pickExt(resp.Header.Get("Content-Type"), imageURL)
	filename := rowID + ext
	dest := filepath.Join(dir, filename)

	tmp, err := os.CreateTemp(dir, ".dl-*")
	if err != nil {
		return "", fmt.Errorf("tempfile: %w", err)
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath) // safe-noop if rename succeeded

	// Cap image size at 8 MiB to bound memory/disk on hostile responses.
	if _, err := io.Copy(tmp, io.LimitReader(resp.Body, 8<<20)); err != nil {
		tmp.Close()
		return "", fmt.Errorf("write: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return "", fmt.Errorf("close tmp: %w", err)
	}
	if err := os.Rename(tmpPath, dest); err != nil {
		return "", fmt.Errorf("rename: %w", err)
	}
	// CreateTemp makes the file 0600. The gateway writes as root into a
	// volume the player serves as an unprivileged user, so the file must be
	// world-readable or the thumbnail 404s on the site (the deploy's manual
	// `chmod -R a+rX` on the volume was papering over exactly this).
	if err := os.Chmod(dest, 0o644); err != nil {
		return "", fmt.Errorf("chmod: %w", err)
	}

	return "/images/markets/" + filename, nil
}

// HashHostedImage returns the hex SHA-256 of the rehosted file backing a
// stored image_path ("/images/markets/<file>"). ok=false when the rehoster is
// nil, the path is not under our markets folder, or the file is unreadable —
// callers treat those rows as unhashable and leave them alone.
func (r *ImageRehoster) HashHostedImage(imagePath string) (string, bool) {
	if r == nil {
		return "", false
	}
	const prefix = "/images/markets/"
	if !strings.HasPrefix(imagePath, prefix) {
		return "", false
	}
	// filepath.Base strips any traversal the DB value could carry; the file
	// must resolve inside the rehost folder.
	name := filepath.Base(strings.TrimPrefix(imagePath, prefix))
	if name == "." || name == "/" || name == ".." {
		return "", false
	}
	f, err := os.Open(filepath.Join(r.PublicRoot, "images", "markets", name))
	if err != nil {
		return "", false
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", false
	}
	return hex.EncodeToString(h.Sum(nil)), true
}

func pickExt(contentType, srcURL string) string {
	switch {
	case strings.HasPrefix(contentType, "image/jpeg"):
		return ".jpg"
	case strings.HasPrefix(contentType, "image/png"):
		return ".png"
	case strings.HasPrefix(contentType, "image/webp"):
		return ".webp"
	case strings.HasPrefix(contentType, "image/gif"):
		return ".gif"
	case strings.HasPrefix(contentType, "image/svg"):
		return ".svg"
	}
	if u, err := url.Parse(srcURL); err == nil {
		ext := strings.ToLower(filepath.Ext(u.Path))
		switch ext {
		case ".jpg", ".jpeg":
			return ".jpg"
		case ".png", ".webp", ".gif", ".svg":
			return ext
		}
	}
	return ".jpg"
}

// HashKey is the stable per-row digest stored in imported_markets.external_hash.
// Hex-encoded SHA-256 of "<source>:<external_id>" — opaque on read, the source
// name doesn't survive in any decodable form.
func HashKey(source, externalID string) string {
	sum := sha256.Sum256([]byte(source + ":" + externalID))
	return hex.EncodeToString(sum[:])
}
