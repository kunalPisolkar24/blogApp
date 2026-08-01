import datetime
import logging
import sys

from pythonjsonlogger.json import JsonFormatter

from src.config import settings
from src.observability.tracing import get_span_ids

NOISY_LOGGERS = ("httpx", "grpc", "asyncio")

# Stable JSON schema for log consumers (Loki/ELK):
# timestamp (RFC3339), level, logger, message, service.
# Optional fields (added without schema break): method, request_id, trace_id,
# span_id (trace_id/span_id present when a trace span is active).
JSON_LOG_FIELDS = "%(timestamp)s %(level)s %(name)s %(message)s"


class JsonLogFormatter(JsonFormatter):
    def add_fields(self, log_data, record, message_dict):
        super().add_fields(log_data, record, message_dict)
        if not log_data.get("timestamp"):
            log_data["timestamp"] = datetime.datetime.fromtimestamp(
                record.created, tz=datetime.UTC
            ).isoformat()
        if not log_data.get("level"):
            log_data["level"] = record.levelname.upper()
        if "name" in log_data and "logger" not in log_data:
            log_data["logger"] = log_data.pop("name")
        log_data.setdefault("service", "ai")
        span_ids = get_span_ids()
        if span_ids is not None:
            log_data["trace_id"], log_data["span_id"] = span_ids
        log_data.pop("exc_info", None)
        if record.exc_info and record.exc_info[0]:
            log_data["stacktrace"] = self.formatException(record.exc_info)


def setup_logging() -> None:
    root = logging.getLogger()
    root.setLevel(settings.LOG_LEVEL.upper())
    root.handlers = []

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonLogFormatter(JSON_LOG_FIELDS))
    root.addHandler(handler)

    for name in NOISY_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)
