package service

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
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
	clock     func() time.Time
}

func NewPostInteractionService(repo domain.PostInteractionRepository, publisher domain.EventPublisher) *PostInteractionService {
	return &PostInteractionService{
		repo:      repo,
		publisher: publisher,
		clock:     time.Now,
	}
}

// RecordView records a view and publishes its event. The unique
// (userId, postId, kind) index makes duplicates idempotent: a repeated
// view returns the existing record and never errors the caller.
func (s *PostInteractionService) RecordView(ctx context.Context, userID, postID string) error {
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

// toggle switches the interaction off when it exists (deleting it,
// without publishing - there is no negative kind), and on otherwise.
// The user id from the caller always keys the lookup, so a user can
// only ever toggle their own interaction.
func (s *PostInteractionService) toggle(ctx context.Context, userID, postID string, kind domain.PostInteractionKind) (bool, error) {
	existing, err := s.repo.FindByUserPostAndKind(ctx, userID, postID, kind)
	if err == nil {
		if err := s.repo.Delete(ctx, existing.ID); err != nil {
			return false, err
		}
		return false, nil
	}
	if !errors.Is(err, domain.ErrNotFound) {
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
		return nil, err
	}

	if err := s.publisher.PublishUserInteracted(ctx, created); err != nil {
		slog.Warn("failed to publish user.interacted event",
			"error", err,
			"user_id", created.UserID,
			"post_id", created.PostID,
			"kind", created.Kind,
		)
	}
	return created, nil
}
