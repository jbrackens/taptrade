package discover

import (
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"image/png"
	"math/rand"
	"os"
	"path/filepath"
	"testing"
)

// wordmark draws dark bars (letters) across a background, like a source's
// wide logo.
func wordmark(w, h int, bg color.Color) *image.RGBA {
	m := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(m, m.Bounds(), &image.Uniform{C: bg}, image.Point{}, draw.Src)
	ink := &image.Uniform{C: color.RGBA{90, 100, 115, 255}}
	for x := w / 10; x < w*9/10; x += w / 12 {
		draw.Draw(m, image.Rect(x, h/4, x+w/30, h*3/4), ink, image.Point{}, draw.Src)
	}
	return m
}

// photo fills the image with varied colour, like a photograph.
func photo(w, h int) *image.RGBA {
	m := image.NewRGBA(image.Rect(0, 0, w, h))
	rng := rand.New(rand.NewSource(7))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			m.Set(x, y, color.RGBA{uint8(x*255/w + rng.Intn(40)), uint8(y*255/h + rng.Intn(40)), uint8(rng.Intn(255)), 255})
		}
	}
	return m
}

// centredMark draws one mark in the middle of a wide canvas, like the WTA
// and NFL logos: a flat graphic that still crops cleanly.
func centredMark(w, h int, bg color.Color) *image.RGBA {
	m := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(m, m.Bounds(), &image.Uniform{C: bg}, image.Point{}, draw.Src)
	draw.Draw(m, image.Rect(w/2-h/3, h/6, w/2+h/3, h*5/6), &image.Uniform{C: color.RGBA{120, 40, 220, 255}}, image.Point{}, draw.Src)
	return m
}

func TestFlatGraphicCropLoss(t *testing.T) {
	if loss, graphic := flatGraphicCropLoss(wordmark(668, 344, color.Transparent)); !graphic || loss <= maxCropLoss {
		t.Errorf("a wordmark on transparency is a graphic the crop slices: loss=%.2f graphic=%v", loss, graphic)
	}
	if loss, graphic := flatGraphicCropLoss(wordmark(900, 300, color.White)); !graphic || loss <= maxCropLoss {
		t.Errorf("a wordmark on white is a graphic the crop slices: loss=%.2f graphic=%v", loss, graphic)
	}
	if loss, graphic := flatGraphicCropLoss(centredMark(300, 222, color.White)); !graphic || loss > maxCropLoss {
		t.Errorf("a centred mark crops cleanly: loss=%.2f graphic=%v", loss, graphic)
	}
	if _, graphic := flatGraphicCropLoss(photo(600, 300)); graphic {
		t.Errorf("a photograph is not a flat graphic")
	}
	// A tricolour flag: its edges are three colours, not one.
	flag := image.NewRGBA(image.Rect(0, 0, 900, 600))
	for i, c := range []color.RGBA{{0, 38, 84, 255}, {255, 255, 255, 255}, {237, 41, 57, 255}} {
		draw.Draw(flag, image.Rect(i*300, 0, (i+1)*300, 600), &image.Uniform{C: c}, image.Point{}, draw.Src)
	}
	if _, graphic := flatGraphicCropLoss(flag); graphic {
		t.Errorf("a tricolour flag crops to its centre fine and must stay")
	}
}

func TestWideGraphic(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "images", "markets")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(name string, img image.Image, asJPEG bool) {
		f, err := os.Create(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		defer f.Close()
		if asJPEG {
			err = jpeg.Encode(f, img, &jpeg.Options{Quality: 85})
		} else {
			err = png.Encode(f, img)
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	write("nations.png", wordmark(668, 344, color.Transparent), false)
	write("kane.jpg", photo(600, 300), true)
	write("square.png", wordmark(400, 400, color.White), false)
	write("banner.jpg", wordmark(900, 300, color.White), true)
	write("wta.png", centredMark(300, 222, color.White), false)

	r := NewImageRehoster(root)
	cases := map[string][2]bool{ // wide, ok
		"/images/markets/nations.png": {true, true},
		"/images/markets/kane.jpg":    {false, true},
		"/images/markets/square.png":  {false, true}, // a square logo fits the tile
		"/images/markets/banner.jpg":  {true, true},  // JPEG noise on white still reads flat
		"/images/markets/wta.png":     {false, true}, // a centred mark crops cleanly
		"/images/markets/missing.png": {false, false},
		"/elsewhere/x.png":            {false, false},
	}
	for path, want := range cases {
		wide, ok := r.WideGraphic(path)
		if wide != want[0] || ok != want[1] {
			t.Errorf("WideGraphic(%s) = %v, %v; want %v, %v", path, wide, ok, want[0], want[1])
		}
	}
}

func TestWideGraphicRowIDs(t *testing.T) {
	calls := 0
	judge := func(path string) (bool, bool) {
		calls++
		switch path {
		case "/images/markets/banner.png":
			return true, true
		case "/images/markets/unreadable.webp":
			return true, false
		}
		return false, true
	}
	rows := []ImportedImageRow{
		{ID: "a", ImagePath: "/images/markets/banner.png"},
		{ID: "b", ImagePath: "/images/markets/banner.png"},
		{ID: "c", ImagePath: "/images/markets/photo.jpg"},
		{ID: "d", ImagePath: "/images/markets/unreadable.webp"},
	}
	got := wideGraphicRowIDs(rows, judge)
	if len(got) != 2 || got[0] != "a" || got[1] != "b" {
		t.Fatalf("rows sharing a wide graphic are all dropped, others kept: %v", got)
	}
	if calls != 3 {
		t.Fatalf("each file is judged once, got %d calls", calls)
	}
}
