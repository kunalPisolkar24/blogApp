from typing import Any

import grpc
import pytest
from grpc_health.v1 import health_pb2, health_pb2_grpc


async def test_health_check_serving(running_server) -> None:
    channel, _ = running_server
    stub: Any = health_pb2_grpc.HealthStub(channel)

    response = await stub.Check(health_pb2.HealthCheckRequest(service=""))

    assert response.status == health_pb2.HealthCheckResponse.SERVING


async def test_unknown_service_not_found(running_server) -> None:
    channel, _ = running_server
    stub: Any = health_pb2_grpc.HealthStub(channel)

    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await stub.Check(health_pb2.HealthCheckRequest(service="nope"))

    assert exc_info.value.code() == grpc.StatusCode.NOT_FOUND


async def test_graceful_shutdown_flips_not_serving(running_server) -> None:
    channel, health_servicer = running_server
    stub: Any = health_pb2_grpc.HealthStub(channel)

    await health_servicer.enter_graceful_shutdown()

    response = await stub.Check(health_pb2.HealthCheckRequest(service=""))

    assert response.status == health_pb2.HealthCheckResponse.NOT_SERVING
