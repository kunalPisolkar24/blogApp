package pagination

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestNormalize(t *testing.T) {
	tests := []struct {
		name        string
		page, limit int
		wantPage    int
		wantLimit   int
	}{
		{name: "missing values default", wantPage: 1, wantLimit: DefaultLimit},
		{name: "zero values default", page: 0, limit: 0, wantPage: 1, wantLimit: DefaultLimit},
		{name: "negative page defaults", page: -1, limit: 10, wantPage: 1, wantLimit: 10},
		{name: "valid values pass through", page: 3, limit: 20, wantPage: 3, wantLimit: 20},
		{name: "limit over max is capped", page: 1, limit: 500, wantPage: 1, wantLimit: MaxLimit},
		{name: "page over max is capped", page: MaxPage + 1, limit: 10, wantPage: MaxPage, wantLimit: 10},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			page, limit := Normalize(tt.page, tt.limit)
			assert.Equal(t, tt.wantPage, page)
			assert.Equal(t, tt.wantLimit, limit)
		})
	}
}

func TestNormalizeMaxSkipFitsInInt(t *testing.T) {
	page, limit := Normalize(MaxPage, MaxLimit)
	assert.Equal(t, MaxPage, page)
	assert.Equal(t, MaxLimit, limit)
	assert.Equal(t, (MaxPage-1)*MaxLimit, (page-1)*limit, "skip offset must stay in int range")
}
