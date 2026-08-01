import logging

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.grpc import GrpcAioInstrumentorServer
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from src.config import settings

logger = logging.getLogger(__name__)


def setup_tracing() -> None:
    if not settings.OTEL_EXPORTER_OTLP_ENDPOINT:
        logger.info("tracing disabled: OTEL_EXPORTER_OTLP_ENDPOINT not set")
        return

    provider = TracerProvider(
        resource=Resource.create({"service.name": settings.OTEL_SERVICE_NAME})
    )
    provider.add_span_processor(
        BatchSpanProcessor(
            OTLPSpanExporter(endpoint=settings.OTEL_EXPORTER_OTLP_ENDPOINT)
        )
    )
    trace.set_tracer_provider(provider)

    GrpcAioInstrumentorServer().instrument()
    HTTPXClientInstrumentor().instrument()
    logger.info(
        "tracing enabled: exporting to %s", settings.OTEL_EXPORTER_OTLP_ENDPOINT
    )


def get_span_ids() -> tuple[str, str] | None:
    """Return (trace_id, span_id) of the current span in hex, or None."""
    span = trace.get_current_span()
    context = span.get_span_context()
    if not context.is_valid:
        return None
    return format(context.trace_id, "032x"), format(context.span_id, "016x")
