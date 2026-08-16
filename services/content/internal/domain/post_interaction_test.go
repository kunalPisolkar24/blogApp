package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestPostInteractionKindWeight(t *testing.T) {
	tests := []struct {
		name   string
		kind   PostInteractionKind
		weight int
	}{
		{name: "view", kind: PostInteractionView, weight: 1},
		{name: "like", kind: PostInteractionLike, weight: 3},
		{name: "save", kind: PostInteractionSave, weight: 5},
		{name: "unknown kind defaults to view weight", kind: PostInteractionKind("unknown"), weight: 1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.weight, tt.kind.Weight())
		})
	}
}
