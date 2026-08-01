import grpc
from grpc_health.v1 import health_pb2, health_pb2_grpc
from grpc_health.v1._async import HealthServicer

from src.api.service import AIService
from src.config import settings
from src.generated import ai_service_pb2_grpc


async def create_server(
    service: AIService,
    port: str | None = None,
) -> tuple[grpc.aio.Server, HealthServicer]:
    server = grpc.aio.server()
    server.add_insecure_port(f"[::]:{port or settings.PORT}")

    health_servicer = HealthServicer()
    health_pb2_grpc.add_HealthServicer_to_server(health_servicer, server)

    ai_service_pb2_grpc.add_AIServiceServicer_to_server(service, server)
    await health_servicer.set("ai.AIService", health_pb2.HealthCheckResponse.SERVING)

    return server, health_servicer
