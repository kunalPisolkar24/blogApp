import time

import docker
import grpc
import pytest
from grpc_health.v1 import health_pb2, health_pb2_grpc
from testcontainers.core.container import DockerContainer

from src.generated import ai_service_pb2_grpc as ai_stubs

IMAGE_TAG = "topos-ai:integration"
GRPC_PORT = 50051
METRICS_PORT = 12666
READY_TIMEOUT_SECONDS = 60.0


@pytest.fixture(scope="session")
def service_image() -> str:
    """Build the service image once per session; skip if docker is unavailable."""
    try:
        client = docker.from_env()
        client.ping()
    except docker.errors.DockerException as exc:
        pytest.skip(f"docker is not available: {exc}")

    client.images.build(path=".", dockerfile="Dockerfile", tag=IMAGE_TAG)
    return IMAGE_TAG


def _wait_healthy(address: str, timeout: float = READY_TIMEOUT_SECONDS) -> None:
    """Block until the gRPC health check reports SERVING for ai.AIService."""
    channel = grpc.insecure_channel(address)
    try:
        grpc.channel_ready_future(channel).result(timeout=timeout)
        stub = health_pb2_grpc.HealthStub(channel)
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                response = stub.Check(
                    health_pb2.HealthCheckRequest(service="ai.AIService"), timeout=2
                )
                if response.status == health_pb2.HealthCheckResponse.SERVING:
                    return
            except grpc.RpcError:
                pass
            time.sleep(0.5)
    finally:
        channel.close()
    raise RuntimeError("ai-service container did not become healthy in time")


class ServiceUnderTest:
    """Handle to the running container: gRPC stub, metrics URL, and logs."""

    def __init__(self, container: DockerContainer) -> None:
        self._container = container
        self.grpc_address = f"{container.get_container_host_ip()}:{container.get_exposed_port(GRPC_PORT)}"
        metrics_address = f"{container.get_container_host_ip()}:{container.get_exposed_port(METRICS_PORT)}"
        self.metrics_url = f"http://{metrics_address}/metrics"
        self.channel = grpc.insecure_channel(self.grpc_address)
        self.stub = ai_stubs.AIServiceStub(self.channel)

    def logs(self) -> str:
        stdout, _ = self._container.get_logs()
        return stdout.decode()


@pytest.fixture(scope="module")
def service(service_image: str) -> ServiceUnderTest:
    """Run the service in a container with LLM_MODE=fake for the module."""
    container = DockerContainer(service_image)
    container.with_env("LLM_MODE", "fake")
    container.with_exposed_ports(GRPC_PORT, METRICS_PORT)
    container.start()

    handle = ServiceUnderTest(container)
    try:
        _wait_healthy(handle.grpc_address)
        yield handle
    finally:
        handle.channel.close()
        container.stop()
