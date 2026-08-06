package ai

import (
	"context"
	"errors"
	"net"
	"testing"

	"github.com/kunalPisolkar24/topos/services/content/internal/domain"
	pb "github.com/kunalPisolkar24/topos/services/content/proto/ai"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
)

type fakeAIServiceServer struct {
	pb.UnimplementedAIServiceServer
	summaryErr error
}

func (f *fakeAIServiceServer) GenerateSummary(ctx context.Context, req *pb.ContentRequest) (*pb.ContentResponse, error) {
	if f.summaryErr != nil {
		return nil, f.summaryErr
	}
	return &pb.ContentResponse{Summary: "summary of " + req.Text}, nil
}

func (f *fakeAIServiceServer) GenerateTags(ctx context.Context, req *pb.ContextRequest) (*pb.TagsResponse, error) {
	return &pb.TagsResponse{Tags: []string{req.Title}}, nil
}

func (f *fakeAIServiceServer) GeneratePost(ctx context.Context, req *pb.PostGenerationRequest) (*pb.PostGenerationResponse, error) {
	return &pb.PostGenerationResponse{Title: "t", Body: "b", Summary: "s", Tags: []string{"go"}}, nil
}

func newTestGRPCClient(t *testing.T, server pb.AIServiceServer) domain.AIService {
	t.Helper()

	listener := bufconn.Listen(1024 * 1024)
	srv := grpc.NewServer()
	pb.RegisterAIServiceServer(srv, server)

	go func() {
		_ = srv.Serve(listener)
	}()
	t.Cleanup(srv.Stop)

	dialer := func(ctx context.Context, addr string) (net.Conn, error) {
		return listener.DialContext(ctx)
	}

	conn, err := grpc.NewClient("passthrough:///bufnet",
		grpc.WithContextDialer(dialer),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	require.NoError(t, err)

	return &grpcClient{client: pb.NewAIServiceClient(conn), conn: conn}
}

func TestGRPCClientGenerateSummary(t *testing.T) {
	client := newTestGRPCClient(t, &fakeAIServiceServer{})

	summary, err := client.GenerateSummary(context.Background(), "hello")
	require.NoError(t, err)
	assert.Equal(t, "summary of hello", summary)
}

func TestGRPCClientGenerateSummaryError(t *testing.T) {
	client := newTestGRPCClient(t, &fakeAIServiceServer{summaryErr: errors.New("rpc failure")})

	_, err := client.GenerateSummary(context.Background(), "hello")
	require.Error(t, err)
}

func TestGRPCClientGenerateTags(t *testing.T) {
	client := newTestGRPCClient(t, &fakeAIServiceServer{})

	tags, err := client.GenerateTags(context.Background(), "go", "body")
	require.NoError(t, err)
	assert.Equal(t, []string{"go"}, tags)
}

func TestGRPCClientGeneratePost(t *testing.T) {
	client := newTestGRPCClient(t, &fakeAIServiceServer{})

	post, err := client.GeneratePost(context.Background(), "prompt")
	require.NoError(t, err)
	assert.Equal(t, &domain.GeneratedPost{Title: "t", Body: "b", Summary: "s", Tags: []string{"go"}}, post)
}

func TestGRPCClientClose(t *testing.T) {
	client := newTestGRPCClient(t, &fakeAIServiceServer{})
	require.NoError(t, client.Close())
}
