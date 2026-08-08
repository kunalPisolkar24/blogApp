//go:build integration

// Kafka helpers shared by integration tests across packages. They are
// compiled out of regular unit runs, so no broker is needed there.
package testutil

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/segmentio/kafka-go"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	tckafka "github.com/testcontainers/testcontainers-go/modules/kafka"
	"github.com/testcontainers/testcontainers-go/wait"
)

// StartKafka boots a single-node Kafka in KRaft mode and returns its
// broker addresses.
func StartKafka(t *testing.T, ctx context.Context) []string {
	t.Helper()

	container, err := tckafka.RunContainer(ctx,
		tckafka.WithClusterID("test-cluster"),
		testcontainers.WithWaitStrategy(wait.ForLog("started (kafka.server.KafkaRaftServer)").WithStartupTimeout(2*time.Minute)),
	)
	require.NoError(t, err)
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })

	brokers, err := container.Brokers(ctx)
	require.NoError(t, err)
	require.NotEmpty(t, brokers)
	return brokers
}

// EnsureTopic creates the topic if it does not exist yet, then blocks
// until it is queryable. Kafka propagates new topic metadata
// asynchronously, so writing right after CreateTopics can race it.
func EnsureTopic(t *testing.T, ctx context.Context, brokers []string, topic string) {
	t.Helper()

	conn, err := kafka.DialContext(ctx, "tcp", brokers[0])
	require.NoError(t, err)
	defer conn.Close()

	controller, err := conn.Controller()
	require.NoError(t, err)

	controllerConn, err := kafka.DialContext(ctx, "tcp", controller.Host+":"+strconv.Itoa(controller.Port))
	require.NoError(t, err)
	defer controllerConn.Close()

	err = controllerConn.CreateTopics(kafka.TopicConfig{Topic: topic, NumPartitions: 1, ReplicationFactor: 1})
	require.NoError(t, err)

	require.Eventually(t, func() bool {
		partitions, err := conn.ReadPartitions(topic)
		return err == nil && len(partitions) > 0
	}, 30*time.Second, 200*time.Millisecond, "topic %s should become queryable", topic)
}
