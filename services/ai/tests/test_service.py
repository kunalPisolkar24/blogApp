import socket

import grpc
import pytest
from grpc_health.v1 import health_pb2, health_pb2_grpc

from src.generated import ai_service_pb2
from src.generated import ai_service_pb2_grpc as ai_stubs
from src.main import create_server


@pytest.fixture
def free_port() -> int:
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


@pytest.fixture
async def running_server(free_port: int):
    server, _ = await create_server(str(free_port))
    await server.start()
    addr = f"127.0.0.1:{free_port}"
    channel = grpc.aio.insecure_channel(addr)

    yield channel

    await channel.close()
    await server.stop(grace=None)


@pytest.mark.parametrize(
    ("method", "rpc_request"),
    [
        ("GenerateSummary", ai_service_pb2.ContentRequest(text="hello")),
        ("GenerateTags", ai_service_pb2.ContextRequest(title="t", body="b")),
        ("GeneratePost", ai_service_pb2.PostGenerationRequest(prompt="topic")),
    ],
)
async def test_rpcs_registered_but_unimplemented(
    running_server, method: str, rpc_request
) -> None:
    channel = running_server
    stub = ai_stubs.AIServiceStub(channel)

    callable_rpc = getattr(stub, method)

    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await callable_rpc(rpc_request)

    assert exc_info.value.code() == grpc.StatusCode.UNIMPLEMENTED


async def test_ai_service_health_serving(running_server) -> None:
    channel = running_server
    stub = health_pb2_grpc.HealthStub(channel)

    response = await stub.Check(health_pb2.HealthCheckRequest(service="ai.AIService"))

    assert response.status == health_pb2.HealthCheckResponse.SERVING
