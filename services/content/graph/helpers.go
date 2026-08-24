package graph

import (
	"context"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/graph/model"
	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/kunalPisolkar24/topos/services/content/internal/middleware"
)

// toggleInteraction runs an interaction toggle for the authenticated
// user and maps its result to the client.
func (r *mutationResolver) toggleInteraction(ctx context.Context, postID string, mode domain.RecommendMode, toggle func(ctx context.Context, userID, postID string, mode domain.RecommendMode) (bool, error)) (bool, error) {
	userID, ok := middleware.UserIDFromContext(ctx)
	if !ok {
		return false, mapDomainError(domain.ErrUnauthorized)
	}

	state, err := toggle(ctx, userID, postID, mode)
	if err != nil {
		return false, mapDomainError(err)
	}
	return state, nil
}

// interactionMode maps an optional GraphQL mode to the domain value.
// nil means the client gave no feed context (opened directly, or from a
// non-recommended list), which stays empty and is not attributed to any
// feed mode.
func interactionMode(mode *model.RecommendMode) domain.RecommendMode {
	if mode == nil {
		return ""
	}
	return recommendModeToDomain(mode)
}

// interactionState resolves the like/save state of the requesting user
// for a post. Anonymous callers get the empty state, so public post
// listings keep working without authentication.
func (r *postResolver) interactionState(ctx context.Context, postID string) (domain.PostInteractionState, error) {
	userID, ok := middleware.UserIDFromContext(ctx)
	if !ok {
		return domain.PostInteractionState{}, nil
	}
	return interactionStatesFrom(ctx, r.InteractionService, userID, postID)
}

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

	reasons := make([]*model.PostReason, 0, len(pp.Reasons))
	for _, dr := range pp.Reasons {
		reasons = append(reasons, &model.PostReason{PostID: dr.PostID, Reason: dr.Reason})
	}

	return &model.PaginatedPosts{
		Posts:       posts,
		TotalPages:  pp.TotalPages,
		TotalPosts:  int(pp.TotalPosts),
		CurrentPage: pp.Page,
		Reasons:     reasons,
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

func mapDomainSearchResultToModel(sr *domain.SearchPostsResult) *model.SearchResult {
	if sr == nil {
		return nil
	}

	hits := make([]*model.Post, 0, len(sr.Hits))
	for _, dp := range sr.Hits {
		if mapped := mapDomainPostToModel(dp); mapped != nil {
			hits = append(hits, mapped)
		}
	}

	return &model.SearchResult{
		Hits:  hits,
		Total: sr.Total,
	}
}

func mapDomainPostsToModel(posts []*domain.Post) []*model.Post {
	related := make([]*model.Post, 0, len(posts))
	for _, dp := range posts {
		if mapped := mapDomainPostToModel(dp); mapped != nil {
			related = append(related, mapped)
		}
	}
	return related
}

func mapDomainChatToModel(dc *domain.Chat) *model.Chat {
	if dc == nil {
		return nil
	}
	return &model.Chat{
		ID:        dc.ID,
		Title:     dc.Title,
		CreatedAt: dc.CreatedAt.String(),
		UpdatedAt: dc.UpdatedAt.String(),
	}
}

func mapDomainChatsToModel(pc *domain.PaginatedChats) *model.PaginatedChats {
	if pc == nil {
		return nil
	}

	chats := make([]*model.Chat, 0, len(pc.Chats))
	for _, dc := range pc.Chats {
		if mapped := mapDomainChatToModel(dc); mapped != nil {
			chats = append(chats, mapped)
		}
	}

	return &model.PaginatedChats{
		Chats:       chats,
		TotalPages:  pc.TotalPages,
		CurrentPage: pc.Page,
		TotalChats:  int(pc.TotalChats),
	}
}

func mapDomainChatMessageToModel(dm *domain.ChatMessage) *model.ChatMessage {
	if dm == nil {
		return nil
	}
	return &model.ChatMessage{
		ID:           dm.ID,
		ChatID:       dm.ChatID,
		Role:         messageRoleToModel(dm.Role),
		Content:      dm.Content,
		CitedPostIds: dm.CitedPostIDs,
		CreatedAt:    dm.CreatedAt.String(),
	}
}

func messageRoleToModel(role domain.ChatMessageRole) model.MessageRole {
	switch role {
	case domain.ChatMessageRoleAssistant:
		return model.MessageRoleAssistant
	default:
		return model.MessageRoleUser
	}
}

func mapDomainPaginatedMessagesToModel(pm *domain.PaginatedMessages) *model.PaginatedMessages {
	if pm == nil {
		return nil
	}

	messages := make([]*model.ChatMessage, 0, len(pm.Messages))
	for _, dm := range pm.Messages {
		if mapped := mapDomainChatMessageToModel(dm); mapped != nil {
			messages = append(messages, mapped)
		}
	}

	return &model.PaginatedMessages{
		Messages:      messages,
		TotalPages:    pm.TotalPages,
		CurrentPage:   pm.Page,
		TotalMessages: int(pm.TotalMessages),
	}
}

func mapDomainPostDraftToModel(dd *domain.PostDraft) *model.PostDraft {
	if dd == nil {
		return nil
	}

	var postID *string
	if dd.PostID != "" {
		postID = &dd.PostID
	}

	return &model.PostDraft{
		ID:         dd.ID,
		ApprovalID: dd.ApprovalID,
		Prompt:     dd.Prompt,
		Title:      dd.Title,
		Body:       dd.Body,
		Summary:    dd.Summary,
		Tags:       dd.Tags,
		Status:     model.DraftStatus(dd.Status),
		AuthorID:   dd.AuthorID,
		PostID:     postID,
		CreatedAt:  dd.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:  dd.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func mapDomainPaginatedPostDraftsToModel(pd *domain.PaginatedPostDrafts) *model.PaginatedPostDrafts {
	if pd == nil {
		return nil
	}

	drafts := make([]*model.PostDraft, 0, len(pd.Drafts))
	for _, draft := range pd.Drafts {
		if mapped := mapDomainPostDraftToModel(draft); mapped != nil {
			drafts = append(drafts, mapped)
		}
	}

	return &model.PaginatedPostDrafts{
		Drafts:      drafts,
		TotalPages:  pd.TotalPages,
		CurrentPage: pd.Page,
		TotalDrafts: int(pd.TotalDrafts),
	}
}

// deref returns the value behind v, or 0 when v is nil. Optional GraphQL
// arguments arrive as pointers, and the resolvers default them to 0 and
// let the services apply their own defaults.
func deref(v *int) int {
	if v == nil {
		return 0
	}
	return *v
}

func derefStr(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

// recommendModeToDomain maps the GraphQL enum to the domain mode. The
// schema default is DEFAULT, so a nil (unspecified) mode means default.
func recommendModeToDomain(mode *model.RecommendMode) domain.RecommendMode {
	if mode == nil {
		return domain.RecommendModeDefault
	}
	switch *mode {
	case model.RecommendModeSurprise:
		return domain.RecommendModeSurprise
	case model.RecommendModeFresh:
		return domain.RecommendModeFresh
	case model.RecommendModeExplorer:
		return domain.RecommendModeExplorer
	default:
		return domain.RecommendModeDefault
	}
}

// seedToUint32 converts the optional seed argument to the unsigned value
// the AI service expects, treating a missing or negative seed as 0.
func seedToUint32(seed *int) uint32 {
	if seed == nil || *seed < 0 {
		return 0
	}
	return uint32(*seed)
}
