package discover

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// The gateway rehosts thumbnails as root into a volume the player serves as
// an unprivileged user, so a rehosted file must be world-readable. CreateTemp
// hands back 0600, which made every worker-rehosted thumbnail 404 on the
// site until a deploy-time chmod happened to run.
func TestRehostWritesWorldReadableFile(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte("\x89PNG\r\n\x1a\nnot really a png"))
	}))
	defer srv.Close()

	root := t.TempDir()
	r := NewImageRehoster(root)
	got, err := r.Rehost("row-1", srv.URL+"/cover.png")
	if err != nil {
		t.Fatalf("Rehost: %v", err)
	}
	if got != "/images/markets/row-1.png" {
		t.Fatalf("web path %q, want /images/markets/row-1.png", got)
	}
	info, err := os.Stat(filepath.Join(root, "images", "markets", "row-1.png"))
	if err != nil {
		t.Fatalf("stat rehosted file: %v", err)
	}
	if perm := info.Mode().Perm(); perm&0o044 != 0o044 {
		t.Fatalf("rehosted file mode %o, want group/other readable", perm)
	}
}
