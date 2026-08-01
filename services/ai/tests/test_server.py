import socket

import grpc
import pytest
from grpc_health.v1 import health_pb2, health_pb2_grpc

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
    server, health_servicer = await create_server(str(free_port))
    await server.start()
    addr = f"127.0.0.1:{free_port}"
    channel = grpc.aio.insecure_channel(addr)
    stub = health_pb2_grpc.HealthStub(channel)

    yield stub, health_servicer

    await channel.close()
    await server.stop(grace=None)


async def test_health_check_serving(running_server) -> None:
    stub, _ = running_server

    response = await stub.Check(health_pb2.HealthCheckRequest(service=""))

    assert response.status == health_pb2.HealthCheckResponse.SERVING


async def test_unknown_service_not_found(running_server) -> None:
    stub, _ = running_server

    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await stub.Check(health_pb2.HealthCheckRequest(service="nope"))

    assert exc_info.value.code() == grpc.StatusCode.NOT_FOUND


async def test_graceful_shutdown_flips_not_serving(running_server) -> None:
    stub, health_servicer = running_server

    await health_servicer.enter_graceful_shutdown()

    response = await stub.Check(health_pb2.HealthCheckRequest(service=""))

    assert response.status == health_pb2.HealthCheckResponse.NOT_SERVING
