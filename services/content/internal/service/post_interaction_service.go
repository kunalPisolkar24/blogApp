package service

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/cache"
	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	"github.com/kunalPisolkar24/topos/services/content/internal/metrics"
)

// Interaction outcome statuses for the interactions_total counter.
const (
	interactionStatusPublished     = "published"
	interactionStatusPublishFailed = "publish_failed"
	interactionStatusDeduplicated  = "deduplicated"
	interactionStatusRemoved       = "removed"
	interactionStatusError         = "error"
)

// PostInteractionService records user interactions (views, likes,
// saves) and publishes the user.interacted event for each new one.
// Interactions are fire-and-forget: a failed event publish is logged,
// never surfaced to the caller, so a Kafka outage cannot break the
// interaction UX. Unlike post events, which workers must not lose,
// interaction events are best-effort personalization signal.
type PostInteractionService struct {
	repo      domain.PostInteractionRepository
	publisher domain.EventPublisher
	cache     *cache.Cache
	clock     func() time.Time
}

func NewPostInteractionService(repo domain.PostInteractionRepository, publisher domain.EventPublisher, cacheClient *cache.Cache) *PostInteractionService {
	return &PostInteractionService{
		repo:      repo,
		publisher: publisher,
		cache:     cacheClient,
		clock:     time.Now,
	}
}

// RecordView records a view and publishes its event. The unique
// (userId, postId, kind) index makes duplicates idempotent: a repeated
// view returns the existing record and never errors the caller. Re-reads
// within 24h are deduped in Redis (seen:{user}:{post}) so they neither
// re-record nor re-publish; likes and saves are unaffected.
func (s *PostInteractionService) RecordView(ctx context.Context, userID, postID string) error {
	if !cache.MarkSeen(s.cache, ctx, cache.KeySeenView(userID, postID), cache.SeenViewTTL) {
		countInteraction(domain.PostInteractionView, interactionStatusDeduplicated)
		return nil
	}
	_, err := s.recordAndPublish(ctx, &domain.PostInteraction{
		UserID:    userID,
		PostID:    postID,
		Kind:      domain.PostInteractionView,
		CreatedAt: s.clock(),
	})
	return err
}

// ToggleLike likes a post when it is not liked yet, and unlikes it
// otherwise. The returned bool is the new state: true means liked.
func (s *PostInteractionService) ToggleLike(ctx context.Context, userID, postID string) (bool, error) {
	return s.toggle(ctx, userID, postID, domain.PostInteractionLike)
}

// ToggleSave saves a post when it is not saved yet, and unsaves it
// otherwise. The returned bool is the new state: true means saved.
func (s *PostInteractionService) ToggleSave(ctx context.Context, userID, postID string) (bool, error) {
	return s.toggle(ctx, userID, postID, domain.PostInteractionSave)
}

// States returns the like/save state of a user for every given post.
// A post the user never interacted with simply has no entry.
func (s *PostInteractionService) States(ctx context.Context, userID string, postIDs []string) (map[string]domain.PostInteractionState, error) {
	return s.repo.ListStates(ctx, userID, postIDs)
}

// toggle switches the interaction off when it exists (deleting it,
// without publishing - there is no negative kind), and on otherwise.
// The user id from the caller always keys the lookup, so a user can
// only ever toggle their own interaction.
func (s *PostInteractionService) toggle(ctx context.Context, userID, postID string, kind domain.PostInteractionKind) (bool, error) {
	existing, err := s.repo.FindByUserPostAndKind(ctx, userID, postID, kind)
	if err == nil {
		if err := s.repo.Delete(ctx, existing.ID); err != nil {
			countInteraction(kind, interactionStatusError)
			return false, err
		}
		countInteraction(kind, interactionStatusRemoved)
		return false, nil
	}
	if !errors.Is(err, domain.ErrNotFound) {
		countInteraction(kind, interactionStatusError)
		return false, err
	}

	if _, err := s.recordAndPublish(ctx, &domain.PostInteraction{
		UserID:    userID,
		PostID:    postID,
		Kind:      kind,
		CreatedAt: s.clock(),
	}); err != nil {
		return false, err
	}
	return true, nil
}

// recordAndPublish stores the interaction and publishes its event. A
// publish failure is logged and swallowed (fire-and-forget).
func (s *PostInteractionService) recordAndPublish(ctx context.Context, interaction *domain.PostInteraction) (*domain.PostInteraction, error) {
	created, err := s.repo.Record(ctx, interaction)
	if err != nil {
		countInteraction(interaction.Kind, interactionStatusError)
		return nil, err
	}

	if err := s.publisher.PublishUserInteracted(ctx, created); err != nil {
		countInteraction(created.Kind, interactionStatusPublishFailed)
		slog.Warn("failed to publish user.interacted event",
			"error", err,
			"user_id", created.UserID,
			"post_id", created.PostID,
			"kind", created.Kind,
		)
		return created, nil
	}
	countInteraction(created.Kind, interactionStatusPublished)
	return created, nil
}

// countInteraction records one interaction outcome on the shared
// interactions_total counter.
func countInteraction(kind domain.PostInteractionKind, status string) {
	metrics.InteractionsTotal.WithLabelValues(string(kind), status).Inc()
}
