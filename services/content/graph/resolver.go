package graph

import "context"

type Resolver struct{}

// Hello is the resolver for the hello field.
func (r *queryResolver) Hello(ctx context.Context) (string, error) {
	return "world", nil
}

// Query returns QueryResolver implementation.
func (r *Resolver) Query() QueryResolver { return &queryResolver{r} }

type queryResolver struct{ *Resolver }
