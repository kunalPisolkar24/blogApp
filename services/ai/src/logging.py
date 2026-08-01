import datetime
import logging
import sys

from pythonjsonlogger.json import JsonFormatter

from src.config import settings

NOISY_LOGGERS = ("httpx", "grpc", "asyncio")

# Stable JSON schema for log consumers (Loki/ELK):
# timestamp (RFC3339), level, logger, message, service.
# Future fields (added without schema break): method, request_id, trace_id, span_id.
JSON_LOG_FIELDS = "%(timestamp)s %(level)s %(name)s %(message)s"


class JsonLogFormatter(JsonFormatter):
    def add_fields(self, log_record, record, message_dict):
        super().add_fields(log_record, record, message_dict)
        if not log_record.get("timestamp"):
            log_record["timestamp"] = datetime.datetime.fromtimestamp(
                record.created, tz=datetime.UTC
            ).isoformat()
        if not log_record.get("level"):
            log_record["level"] = record.levelname.upper()
        if "name" in log_record and "logger" not in log_record:
            log_record["logger"] = log_record.pop("name")
        log_record.setdefault("service", "ai")
        if record.exc_info and record.exc_info[0]:
            log_record["stacktrace"] = self.formatException(record.exc_info)


def setup_logging() -> None:
    root = logging.getLogger()
    root.setLevel(settings.LOG_LEVEL.upper())
    root.handlers = []

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonLogFormatter(JSON_LOG_FIELDS))
    root.addHandler(handler)

    for name in NOISY_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)
