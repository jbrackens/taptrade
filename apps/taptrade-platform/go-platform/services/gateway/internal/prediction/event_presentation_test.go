package prediction

import "testing"

func TestNormalizeCoverImageURL(t *testing.T) {
	ok := map[string]string{
		"":                                   "",
		"   ":                                "",
		"/images/covers/pba.jpg":             "/images/covers/pba.jpg",
		" /images/markets/abc.png ":          "/images/markets/abc.png",
		"https://images.example.com/a.jpg":   "https://images.example.com/a.jpg",
		"https://cdn.example.com/x.jpg?w=16": "https://cdn.example.com/x.jpg?w=16",
	}
	for in, want := range ok {
		got, err := normalizeCoverImageURL(in)
		if err != nil {
			t.Fatalf("normalizeCoverImageURL(%q) unexpected error: %v", in, err)
		}
		if got != want {
			t.Fatalf("normalizeCoverImageURL(%q) = %q, want %q", in, got, want)
		}
	}

	bad := []string{
		"http://images.example.com/a.jpg", // mixed content
		"javascript:alert(1)",
		"data:image/png;base64,AAAA",
		"//evil.example.com/a.jpg", // protocol-relative
		"/brand/logo.svg",          // outside /images/
		"/images/../auth/login",    // escapes /images/
		"/images/a b.jpg",
		"https://user:pass@example.com/a.jpg",
		"ftp://example.com/a.jpg",
	}
	for _, in := range bad {
		if _, err := normalizeCoverImageURL(in); err == nil {
			t.Fatalf("normalizeCoverImageURL(%q) should be rejected", in)
		}
	}
}
