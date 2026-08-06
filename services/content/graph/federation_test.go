package graph

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/99designs/gqlgen/graphql/handler"
	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/kunalPisolkar24/topos/services/content/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func executeQuery(t *testing.T, resolver *Resolver, query string) *httptest.ResponseRecorder {
	t.Helper()

	gql := handler.NewDefaultServer(NewExecutableSchema(Config{Resolvers: resolver}))

	req := httptest.NewRequest(http.MethodPost, "/query", bytes.NewBufferString(`{"query":`+query+`}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	gql.ServeHTTP(rec, req)
	return rec
}

func TestFederationEntities(t *testing.T) {
	repo := &testutil.MockPostRepository{FindByIDFn: func(ctx context.Context, id string) (*domain.Post, error) {
		return &domain.Post{ID: id, Title: "Federated"}, nil
	}}
	resolver, _, _ := newTestResolver(t, repo, nil)

	rec := executeQuery(t, resolver, `"{ _entities(representations: [{__typename: \"Post\", id: \"p_1\"}, {__typename: \"User\", id: \"u_1\"}]) { __typename ... on Post { id title } ... on User { id } } }"`)

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), "Federated")
	assert.Contains(t, rec.Body.String(), "u_1")
}

func TestFederationEntitiesUnknownType(t *testing.T) {
	resolver, _, _ := newTestResolver(t, nil, nil)

	rec := executeQuery(t, resolver, `"{ _entities(representations: [{__typename: \"Nope\", id: \"1\"}]) { __typename } }"`)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), "unknown type")
}

func TestFederationEntitiesMissingKey(t *testing.T) {
	resolver, _, _ := newTestResolver(t, nil, nil)

	rec := executeQuery(t, resolver, `"{ _entities(representations: [{__typename: \"Post\"}]) { __typename } }"`)

	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestFederationServiceSDL(t *testing.T) {
	resolver, _, _ := newTestResolver(t, nil, nil)

	rec := executeQuery(t, resolver, `"{ _service { sdl } }"`)

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), "schema")
}
