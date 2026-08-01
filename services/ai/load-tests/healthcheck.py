import sys

import grpc
from grpc_health.v1 import health_pb2, health_pb2_grpc

channel = grpc.insecure_channel("127.0.0.1:50051")
response = health_pb2_grpc.HealthStub(channel).Check(
    health_pb2.HealthCheckRequest(service="ai.AIService"), timeout=5
)
sys.exit(0 if response.status == health_pb2.HealthCheckResponse.SERVING else 1)
