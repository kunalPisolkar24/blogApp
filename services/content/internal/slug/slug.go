package slug

import (
	"strings"
	"time"
	"unicode"
)

// Generate converts a title into a URL-friendly slug with a UTC,
// nanosecond-resolution timestamp suffix so slugs are unique regardless
// of the server timezone or how close in time two posts are created.
func Generate(title string, now time.Time) string {
	var b strings.Builder
	b.Grow(len(title) + 32)
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

	return slug + "-" + now.UTC().Format("20060102150405.000000000")
}
