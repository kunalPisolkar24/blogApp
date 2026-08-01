import json
import logging

from src.config import settings
from src.observability.logging import setup_logging


def test_log_output_is_json_with_schema(capsys) -> None:
    setup_logging()

    logging.getLogger("test.module").info("hello")

    line = capsys.readouterr().out.strip()
    record = json.loads(line)

    assert set(record) == {"timestamp", "level", "logger", "message", "service"}
    assert record["level"] == "INFO"
    assert record["logger"] == "test.module"
    assert record["message"] == "hello"
    assert record["service"] == "ai"
    assert record["timestamp"].endswith("+00:00")


def test_error_level_uppercased(capsys) -> None:
    setup_logging()

    logging.getLogger("test.module").error("boom")

    record = json.loads(capsys.readouterr().out.strip())
    assert record["level"] == "ERROR"


def test_log_level_respected(monkeypatch, capsys) -> None:
    monkeypatch.setattr(settings, "LOG_LEVEL", "ERROR")
    setup_logging()

    logger = logging.getLogger("test.module")
    logger.info("hidden")

    assert capsys.readouterr().out == ""

    logger.error("visible")

    record = json.loads(capsys.readouterr().out.strip())
    assert record["message"] == "visible"


def test_exception_logs_stacktrace(capsys) -> None:
    setup_logging()

    logger = logging.getLogger("test.module")
    try:
        raise ValueError("boom")
    except ValueError:
        logger.exception("operation failed")

    record = json.loads(capsys.readouterr().out.strip())

    assert record["level"] == "ERROR"
    assert record["message"] == "operation failed"
    assert "ValueError" in record["stacktrace"]
    assert "boom" in record["stacktrace"]
