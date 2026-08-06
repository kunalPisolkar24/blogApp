package bootstrap

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCloseNilDependencies(t *testing.T) {
	d := &Dependencies{}
	require.NotPanics(t, func() { d.Close(context.Background()) })
}
