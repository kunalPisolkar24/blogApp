package slug

import (
	"strings"
	"time"
	"unicode"
)

// Generate converts a title into a URL-friendly slug with a
// timestamp suffix to keep slugs unique.
func Generate(title string, now time.Time) string {
	var b strings.Builder
	b.Grow(len(title) + 16)
	prevDash := false

	for _, r := range strings.ToLower(title) {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
			prevDash = false
		case unicode.IsSpace(r) || r == '-' || r == '_':
			if !prevDash && b.Len() > 0 {
				b.WriteRune('-')
				prevDash = true
			}
		default:
			if !prevDash && b.Len() > 0 {
				b.WriteRune('-')
				prevDash = true
			}
		}
	}

	slug := strings.TrimRight(b.String(), "-")
	if slug == "" {
		slug = "post"
	}

	return slug + "-" + now.Format("20060102150405")
}
