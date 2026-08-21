"""Bridge LangSmith settings into the SDK's environment variables."""

import logging
import os

from src.config import settings

logger = logging.getLogger(__name__)


def setup_langsmith() -> None:
    """Expose the LangSmith settings to the SDK.

    The SDK reads plain environment variables and caches what it finds,
    while Settings also picks values up from .env files — so tracing
    configured only through a file would stay invisible to it unless
    mirrored here before the first LLM call.
    """
    if not settings.LANGCHAIN_TRACING:
        logger.info("langsmith tracing disabled: LANGCHAIN_TRACING not set")
        return

    os.environ["LANGSMITH_TRACING"] = "true"
    if settings.LANGCHAIN_API_KEY:
        os.environ["LANGSMITH_API_KEY"] = settings.LANGCHAIN_API_KEY
    if settings.LANGCHAIN_PROJECT:
        os.environ["LANGSMITH_PROJECT"] = settings.LANGCHAIN_PROJECT
    logger.info("langsmith tracing enabled: project %s", settings.LANGCHAIN_PROJECT)
