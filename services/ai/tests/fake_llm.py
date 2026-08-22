class FakeLLM:
    """Scripted fake LLM: returns a canned response or raises an error."""

    def __init__(
        self,
        response: str = "",
        error: Exception | None = None,
        chunks: list[str] | None = None,
    ) -> None:
        self.response = response
        self.error = error
        self.chunks = chunks
        self.calls: list[tuple[str, str]] = []
        self.stream_calls: list[tuple[str, str]] = []

    async def generate_completion(self, system: str, user: str) -> str:
        self.calls.append((system, user))
        if self.error is not None:
            raise self.error
        return self.response

    async def generate_tool_completion(self, messages, tools):
        from src.llm import CompletionReply

        return CompletionReply(content=None)

    async def generate_stream(self, system: str, user: str):
        self.stream_calls.append((system, user))
        if self.error is not None:
            raise self.error
        for delta in self.chunks if self.chunks is not None else [self.response]:
            yield delta
