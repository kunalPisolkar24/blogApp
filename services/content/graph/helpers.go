package graph

import (
	"github.com/kunalPisolkar24/topos/services/content/graph/model"
	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
)

func mapTags(tagNames []string) []*model.Tag {
	var tags []*model.Tag
	for _, name := range tagNames {
		tags = append(tags, &model.Tag{ID: name, Name: name})
	}
	return tags
}

func mapDomainPostToModel(dp *domain.Post) *model.Post {
	if dp == nil {
		return nil
	}

	var summaryStatus *model.SummaryStatus
	if dp.SummaryStatus != "" {
		status := model.SummaryStatus(dp.SummaryStatus)
		if status.IsValid() {
			summaryStatus = &status
		}
	}

	var summary *string
	if dp.Summary != "" {
		summary = &dp.Summary
	}

	return &model.Post{
		ID:            dp.ID,
		Title:         dp.Title,
		Body:          dp.Body,
		Slug:          dp.Slug,
		ImageURL:      dp.ImageUrl,
		Summary:       summary,
		SummaryStatus: summaryStatus,
		Tags:          mapTags(dp.Tags),
		CreatedAt:     dp.CreatedAt.String(),
		UpdatedAt:     dp.UpdatedAt.String(),
		Author:        &model.User{ID: dp.AuthorID},
	}
}

func mapDomainPaginatedToModel(pp *domain.PaginatedPosts) *model.PaginatedPosts {
	if pp == nil {
		return nil
	}

	posts := make([]*model.Post, 0, len(pp.Posts))
	for _, dp := range pp.Posts {
		if mapped := mapDomainPostToModel(dp); mapped != nil {
			posts = append(posts, mapped)
		}
	}

	return &model.PaginatedPosts{
		Posts:       posts,
		TotalPages:  pp.TotalPages,
		TotalPosts:  int(pp.TotalPosts),
		CurrentPage: pp.Page,
	}
}

func mapDomainTagsToModel(tags []*domain.Tag) []*model.Tag {
	out := make([]*model.Tag, 0, len(tags))
	for _, t := range tags {
		if t == nil {
			continue
		}
		out = append(out, &model.Tag{ID: t.ID, Name: t.Name})
	}
	return out
}

func mapDomainGeneratedPostToModel(gp *domain.GeneratedPost) *model.GeneratedPost {
	if gp == nil {
		return nil
	}
	return &model.GeneratedPost{
		Title:   gp.Title,
		Body:    gp.Body,
		Summary: gp.Summary,
		Tags:    gp.Tags,
	}
}
