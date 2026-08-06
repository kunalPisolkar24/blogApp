.PHONY: test test-integration coverage vet lint fmt

# Excluded from the coverage report:
#   - generated code (gqlgen, protobuf): no hand-written logic
#   - db, repository: covered by the integration suite (testcontainers)
#   - bootstrap, cmd: entrypoint wiring only
#   - testutil: test doubles
GENERATED_RE := 'graph/generated.go|graph/model/|proto/ai/|\.pb\.go|internal/db/|internal/repository/|internal/bootstrap/|internal/testutil/|cmd/'

test:
	go test ./...

test-integration:
	go test -tags integration ./...

vet:
	go vet ./...
	go vet -tags integration ./...

fmt:
	gofmt -l .

coverage:
	go test ./... -coverprofile=/tmp/content-coverage.out
	grep -vE $(GENERATED_RE) /tmp/content-coverage.out > /tmp/content-coverage.filtered.out
	@go tool cover -func=/tmp/content-coverage.filtered.out | tail -1
