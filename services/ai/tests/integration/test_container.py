import json

import httpx
import pytest
from grpc_health.v1 import health_pb2, health_pb2_grpc

from src.config import settings
from src.generated import ai_service_pb2
from src.llm import FakeLLMClient

pytestmark = pytest.mark.container


def _counter_value(service, metric: str, labels: dict[str, str]) -> float:
    """Scrape /metrics and return the value of a counter (0 if absent)."""
    body = httpx.get(service.metrics_url, timeout=5).text

    if labels:
        labels_str = ",".join(f'{key}="{value}"' for key, value in labels.items())
        prefix = f"{metric}{{{labels_str}}}"
    else:
        prefix = f"{metric} "
    for line in body.splitlines():
        if line.startswith(prefix):
            return float(line.split()[-1])
    return 0.0


def test_grpc_health_serving(service) -> None:
    stub = health_pb2_grpc.HealthStub(service.channel)

    response = stub.Check(health_pb2.HealthCheckRequest(service="ai.AIService"))

    assert response.status == health_pb2.HealthCheckResponse.SERVING


def test_generate_summary_returns_fake_output(service) -> None:
    response = service.stub.GenerateSummary(ai_service_pb2.ContentRequest(text="hello"))

    assert response.summary == FakeLLMClient._SUMMARY


def test_generate_tags_returns_fake_output(service) -> None:
    response = service.stub.GenerateTags(
        ai_service_pb2.ContextRequest(title="t", body="b")
    )

    assert list(response.tags) == json.loads(FakeLLMClient._TAGS)


def test_generate_post_returns_fake_output(service) -> None:
    response = service.stub.GeneratePost(
        ai_service_pb2.PostGenerationRequest(prompt="topic")
    )

    post = json.loads(FakeLLMClient._POST)
    assert response.title == post["title"]
    assert response.body == post["body"]
    assert response.summary == post["summary"]
    assert list(response.tags) == post["tags"]


def test_metrics_record_grpc_counter(service) -> None:
    labels = {"method": "/ai.AIService/GenerateSummary", "status": "OK"}
    before = _counter_value(service, "grpc_requests_total", labels)

    service.stub.GenerateSummary(ai_service_pb2.ContentRequest(text="hello"))

    assert _counter_value(service, "grpc_requests_total", labels) == before + 1


def test_metrics_expose_process_stats(service) -> None:
    body = httpx.get(service.metrics_url, timeout=5).text

    assert "process_resident_memory_bytes" in body
    assert "grpc_active_requests" in body


def test_fake_mode_records_no_llm_calls(service) -> None:
    service.stub.GenerateSummary(ai_service_pb2.ContentRequest(text="hello"))

    model = settings.LLM_MODEL
    assert (
        _counter_value(
            service, "llm_requests_total", {"status": "success", "model": model}
        )
        == 0.0
    )
    assert (
        _counter_value(
            service, "llm_requests_total", {"status": "error", "model": model}
        )
        == 0.0
    )


def test_logs_are_json_and_include_access_log(service) -> None:
    service.stub.GenerateSummary(ai_service_pb2.ContentRequest(text="hello"))

    records = [json.loads(line) for line in service.logs().splitlines() if line.strip()]
    assert records
    assert all(record.get("service") == "ai" for record in records)

    access = next(r for r in records if r.get("message") == "rpc completed")
    assert access["method"] == "/ai.AIService/GenerateSummary"
    assert access["status"] == "OK"
    assert access["duration_ms"] > 0
    assert access["trace_id"] == "-"
    assert access["span_id"] == "-"


def test_metrics_expose_recommend_families(service) -> None:
    body = httpx.get(service.metrics_url, timeout=5).text

    for family in (
        "recommend_requests_total",
        "recommend_request_duration_seconds",
        "profile_updates_total",
        "recommend_cold_start_total",
        "recommend_cold_start_ratio",
    ):
        assert family in body


def test_metrics_record_recommend_and_cold_start(service) -> None:
    recommend_labels = {"method": "default", "status": "OK"}
    recommend_before = _counter_value(
        service, "recommend_requests_total", recommend_labels
    )
    cold_before = _counter_value(service, "recommend_cold_start_total", {})

    service.stub.RecommendFeed(
        ai_service_pb2.RecommendRequest(user_id="metrics-cold-user")
    )

    assert (
        _counter_value(service, "recommend_requests_total", recommend_labels)
        == recommend_before + 1
    )
    assert _counter_value(service, "recommend_cold_start_total", {}) == cold_before + 1


def test_metrics_record_profile_updates(service) -> None:
    labels = {"kind": "view"}
    before = _counter_value(service, "profile_updates_total", labels)

    service.stub.UpdateUserProfile(
        ai_service_pb2.UserProfileUpdateRequest(
            user_id="metrics-user",
            post_id="6a75a41221a9752ec47bc6df",
            kind=ai_service_pb2.INTERACTION_KIND_VIEW,
        )
    )

    assert _counter_value(service, "profile_updates_total", labels) == before + 1


def test_access_log_carries_recommend_fields(service) -> None:
    service.stub.RecommendFeed(ai_service_pb2.RecommendRequest(user_id="metrics-user"))

    records = [json.loads(line) for line in service.logs().splitlines() if line.strip()]
    access = next(
        r for r in records if r.get("method") == "/ai.AIService/RecommendFeed"
    )
    assert access["message"] == "rpc completed"
    assert access["mode"] == "default"
    assert access["result_count"] == 0
    assert access["total"] == 0
