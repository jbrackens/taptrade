package discover

import (
	"image"
	"os"
	"path/filepath"
	"strings"
)

// Wide graphics. A market thumbnail is a square tile that crops its image
// to the centre, which is harmless for a photo and ruinous for a wide logo:
// a source's wordmark comes out as a slice ("UEFA NATIONS LEAGUE" read "EFA
// TIOI AGU" on the Nations League games, "VALORANT" read "ALORAN",
// 2026-09-28). A wide image counts as a graphic when much of it is
// transparent, or when its edges are one flat colour that also fills most
// of the picture — marks on a plain background. It is set aside only when
// the centre crop would cut off more than a tenth of those marks: the WTA
// and NFL logos sit in the middle of their wide canvases and crop cleanly.
// Photos pass either way.

const (
	// wideAspect: beyond this (or its inverse) a centre crop loses content.
	wideAspect = 1.25
	// maxCropLoss: the share of a graphic's marks a centre crop may cut off.
	// On the 2026-09-28 board the Nations League wordmark lost 47% and
	// Valorant's (a centred V over a full-width word) 15%; every other
	// source cover, WTA and NFL included, lost none.
	maxCropLoss = 0.1
	// maxShapePixels bounds the full decode of one hosted file.
	maxShapePixels = 40_000_000
)

// WideGraphic reports whether a hosted cover ("/images/markets/<file>") is a
// wide flat graphic that the square tile would crop to a slice. ok is false
// when the file cannot be read or decoded (SVG, WebP): such covers are left
// alone.
func (r *ImageRehoster) WideGraphic(imagePath string) (wide bool, ok bool) {
	if r == nil {
		return false, false
	}
	const prefix = "/images/markets/"
	if !strings.HasPrefix(imagePath, prefix) {
		return false, false
	}
	name := filepath.Base(strings.TrimPrefix(imagePath, prefix))
	if name == "." || name == "/" || name == ".." {
		return false, false
	}
	path := filepath.Join(r.PublicRoot, "images", "markets", name)
	f, err := os.Open(path)
	if err != nil {
		return false, false
	}
	cfg, _, err := image.DecodeConfig(f)
	f.Close()
	if err != nil || cfg.Width == 0 || cfg.Height == 0 {
		return false, false
	}
	aspect := float64(cfg.Width) / float64(cfg.Height)
	if aspect <= wideAspect && aspect >= 1/wideAspect {
		return false, true
	}
	if cfg.Width*cfg.Height > maxShapePixels {
		return false, false
	}
	f, err = os.Open(path)
	if err != nil {
		return false, false
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	if err != nil {
		return false, false
	}
	loss, graphic := flatGraphicCropLoss(img)
	return graphic && loss > maxCropLoss, true
}

// flatGraphicCropLoss samples the image. It is a flat graphic when a
// quarter or more is transparent, or when its edges are ≥85% one colour that
// also covers ≥45% of the interior; its marks are the samples that are
// neither transparent nor that background colour. loss is the share of the
// marks outside the centred square a thumbnail keeps.
func flatGraphicCropLoss(img image.Image) (loss float64, graphic bool) {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w == 0 || h == 0 {
		return 0, false
	}
	type sample struct {
		x, y int
		key  uint32
		a    uint32
	}
	const grid = 48
	var samples []sample
	transparent := 0
	interior := map[uint32]int{}
	for gy := 0; gy < grid; gy++ {
		for gx := 0; gx < grid; gx++ {
			x := b.Min.X + (gx*2+1)*w/(grid*2)
			y := b.Min.Y + (gy*2+1)*h/(grid*2)
			key, a := colourKey(img, x, y)
			samples = append(samples, sample{x, y, key, a})
			if a < 0x2000 {
				transparent++
			} else {
				interior[key]++
			}
		}
	}

	byAlpha := transparent*4 >= len(samples)
	var background uint32
	if !byAlpha {
		edge := map[uint32]int{}
		edgeSamples := 0
		const perEdge = 64
		for i := 0; i < perEdge; i++ {
			x := b.Min.X + (i*2+1)*w/(perEdge*2)
			y := b.Min.Y + (i*2+1)*h/(perEdge*2)
			for _, p := range [][2]int{{x, b.Min.Y}, {x, b.Max.Y - 1}, {b.Min.X, y}, {b.Max.X - 1, y}} {
				key, _ := colourKey(img, p[0], p[1])
				edge[key]++
				edgeSamples++
			}
		}
		topCount := 0
		for key, n := range edge {
			if n > topCount {
				background, topCount = key, n
			}
		}
		if topCount*100 < edgeSamples*85 || interior[background]*100 < (len(samples)-transparent)*45 {
			return 0, false
		}
	}

	// The centred square a thumbnail keeps.
	keepMin, keepMax := b.Min.X+(w-h)/2, b.Min.X+(w+h)/2
	horizontal := w > h
	if !horizontal {
		keepMin, keepMax = b.Min.Y+(h-w)/2, b.Min.Y+(h+w)/2
	}
	marks, lost := 0, 0
	for _, s := range samples {
		if s.a < 0x2000 || (!byAlpha && s.key == background) {
			continue
		}
		marks++
		pos := s.x
		if !horizontal {
			pos = s.y
		}
		if pos < keepMin || pos >= keepMax {
			lost++
		}
	}
	if marks == 0 {
		return 0, true
	}
	return float64(lost) / float64(marks), true
}

// colourKey buckets a pixel's colour to 4 bits a channel, so JPEG noise on
// a flat background still counts as one colour; it also returns alpha.
func colourKey(img image.Image, x, y int) (uint32, uint32) {
	r, g, bl, a := img.At(x, y).RGBA()
	return (r>>12)<<8 | (g>>12)<<4 | bl>>12, a
}
