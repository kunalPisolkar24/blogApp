package domain

import "context"

type Tag struct {
	ID   string `bson:"_id,omitempty" json:"id,omitempty"`
	Name string `bson:"name" json:"name"`
}

type TagRepository interface {
	CreateOrFind(ctx context.Context, name string) (*Tag, error)
	FindAll(ctx context.Context) ([]*Tag, error)
	Search(ctx context.Context, query string, limit int) ([]*Tag, error)
}
