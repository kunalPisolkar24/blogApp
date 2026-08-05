package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/99designs/gqlgen/graphql/handler"
	"github.com/99designs/gqlgen/graphql/playground"
	"github.com/kunalPisolkar24/topos/services/content/graph"
	"github.com/kunalPisolkar24/topos/services/content/internal/config"
)

const queryPath = "/query"

func main() {
	if err := run(); err != nil {
		slog.Error("server terminated with error", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg := config.LoadConfig()

	mux := http.NewServeMux()
	mux.Handle(queryPath, handler.NewDefaultServer(graph.NewExecutableSchema(graph.Config{Resolvers: &graph.Resolver{}})))
	mux.Handle("/", playground.Handler("GraphQL playground", queryPath))

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		slog.Info("content service listening", "addr", srv.Addr, "playground", queryPath)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}

	slog.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		return err
	}
	if err := <-errCh; err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
