import time

import docker
import grpc
import httpx
import psycopg
import pytest
from grpc_health.v1 import health_pb2, health_pb2_grpc
from testcontainers.core.container import DockerContainer
from testcontainers.core.network import Network

from src.generated import ai_service_pb2_grpc as ai_stubs

IMAGE_TAG = "topos-ai:integration"
GRPC_PORT = 50051
METRICS_PORT = 12666
POSTGRES_PORT = 5432
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

    def stop(self) -> None:
        self.channel.close()
        self._container.stop()


@pytest.fixture(scope="module")
def network() -> Network:
    """Shared network so the service and qdrant can talk by name."""
    network = Network()
    network.create()
    yield network
    network.remove()


def _wait_ready(url: str, timeout: float = READY_TIMEOUT_SECONDS) -> None:
    """Block until the endpoint answers, or the timeout elapses."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if httpx.get(url, timeout=2).status_code == 200:
                return
        except (httpx.HTTPError, ConnectionError):
            pass
        time.sleep(0.5)
    raise RuntimeError(f"container did not become ready at {url} in time")


@pytest.fixture(scope="module")
def qdrant(network: Network) -> DockerContainer:
    """Real qdrant for the search tests; reachable as http://qdrant:6333."""
    container = DockerContainer("qdrant/qdrant:v1.19.0")
    container.with_network(network)
    container.with_network_aliases("qdrant")
    container.with_exposed_ports(6333)
    container.start()

    host = container.get_container_host_ip()
    port = container.get_exposed_port(6333)
    try:
        _wait_ready(f"http://{host}:{port}/readyz")
        yield container
    finally:
        container.stop()


@pytest.fixture(scope="module")
def start_service(service_image: str, network: Network, qdrant: DockerContainer):
    """Factory fixture: start a service container with extra env overrides."""

    def _start(extra_env: dict[str, str] | None = None) -> ServiceUnderTest:
        container = DockerContainer(service_image)
        container.with_env("LLM_MODE", "fake")
        container.with_env("EMBEDDING_MODE", "fake")
        container.with_env("QDRANT_URL", "http://qdrant:6333")
        for key, value in (extra_env or {}).items():
            container.with_env(key, value)
        container.with_network(network)
        container.with_exposed_ports(GRPC_PORT, METRICS_PORT)
        container.start()

        handle = ServiceUnderTest(container)
        try:
            _wait_healthy(handle.grpc_address)
            return handle
        except Exception:
            handle.stop()
            raise

    return _start


@pytest.fixture(scope="module")
def service(start_service) -> ServiceUnderTest:
    """Run the service in a container with fake llm and embeddings."""
    handle = start_service()
    yield handle
    handle.stop()


@pytest.fixture(scope="module")
def ai_postgres(network: Network) -> DockerContainer:
    """Real postgres for the checkpointer; reachable as ai-postgres:5432."""
    container = DockerContainer("postgres:16-alpine")
    container.with_env("POSTGRES_USER", "ai_checkpointer")
    container.with_env("POSTGRES_PASSWORD", "ai_checkpointer_pass")
    container.with_env("POSTGRES_DB", "ai_checkpoints")
    container.with_network(network)
    container.with_network_aliases("ai-postgres")
    container.with_exposed_ports(POSTGRES_PORT)
    container.start()

    host = container.get_container_host_ip()
    port = container.get_exposed_port(POSTGRES_PORT)
    try:
        _wait_postgres_ready(host, port)
        yield container
    finally:
        container.stop()


def _wait_postgres_ready(
    host: str, port: int, timeout: float = READY_TIMEOUT_SECONDS
) -> None:
    """Block until postgres accepts connections with the checkpointer creds."""
    url = (
        f"postgresql://ai_checkpointer:ai_checkpointer_pass@{host}:{port}/"
        "ai_checkpoints"
    )
    deadline = time.monotonic() + timeout
    last: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with psycopg.connect(url, connect_timeout=2) as conn:
                conn.execute("SELECT 1")
            return
        except psycopg.Error as exc:
            last = exc
            time.sleep(0.5)
    raise RuntimeError(f"postgres did not become ready in time: {last}")


@pytest.fixture(scope="module")
def checkpoint_service(start_service, ai_postgres) -> ServiceUnderTest:
    """Service backed by the real postgres checkpointer."""
    handle = start_service(
        {
            "CHECKPOINT_DB_URL": (
                "postgresql://ai_checkpointer:ai_checkpointer_pass@"
                "ai-postgres:5432/ai_checkpoints"
            )
        }
    )
    yield handle
    handle.stop()
