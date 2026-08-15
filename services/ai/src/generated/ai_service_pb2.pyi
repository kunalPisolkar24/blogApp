from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ContentRequest(_message.Message):
    __slots__ = ("text",)
    TEXT_FIELD_NUMBER: _ClassVar[int]
    text: str
    def __init__(self, text: _Optional[str] = ...) -> None: ...

class ContentResponse(_message.Message):
    __slots__ = ("summary",)
    SUMMARY_FIELD_NUMBER: _ClassVar[int]
    summary: str
    def __init__(self, summary: _Optional[str] = ...) -> None: ...

class ContextRequest(_message.Message):
    __slots__ = ("title", "body")
    TITLE_FIELD_NUMBER: _ClassVar[int]
    BODY_FIELD_NUMBER: _ClassVar[int]
    title: str
    body: str
    def __init__(self, title: _Optional[str] = ..., body: _Optional[str] = ...) -> None: ...

class TagsResponse(_message.Message):
    __slots__ = ("tags",)
    TAGS_FIELD_NUMBER: _ClassVar[int]
    tags: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, tags: _Optional[_Iterable[str]] = ...) -> None: ...

class PostGenerationRequest(_message.Message):
    __slots__ = ("prompt",)
    PROMPT_FIELD_NUMBER: _ClassVar[int]
    prompt: str
    def __init__(self, prompt: _Optional[str] = ...) -> None: ...

class PostGenerationResponse(_message.Message):
    __slots__ = ("title", "body", "summary", "tags")
    TITLE_FIELD_NUMBER: _ClassVar[int]
    BODY_FIELD_NUMBER: _ClassVar[int]
    SUMMARY_FIELD_NUMBER: _ClassVar[int]
    TAGS_FIELD_NUMBER: _ClassVar[int]
    title: str
    body: str
    summary: str
    tags: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, title: _Optional[str] = ..., body: _Optional[str] = ..., summary: _Optional[str] = ..., tags: _Optional[_Iterable[str]] = ...) -> None: ...

class IndexRequest(_message.Message):
    __slots__ = ("post_id", "title", "body", "summary", "tags", "created_at")
    POST_ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    BODY_FIELD_NUMBER: _ClassVar[int]
    SUMMARY_FIELD_NUMBER: _ClassVar[int]
    TAGS_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    post_id: str
    title: str
    body: str
    summary: str
    tags: _containers.RepeatedScalarFieldContainer[str]
    created_at: str
    def __init__(self, post_id: _Optional[str] = ..., title: _Optional[str] = ..., body: _Optional[str] = ..., summary: _Optional[str] = ..., tags: _Optional[_Iterable[str]] = ..., created_at: _Optional[str] = ...) -> None: ...

class IndexResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class DeleteRequest(_message.Message):
    __slots__ = ("post_id",)
    POST_ID_FIELD_NUMBER: _ClassVar[int]
    post_id: str
    def __init__(self, post_id: _Optional[str] = ...) -> None: ...

class DeleteResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class SearchRequest(_message.Message):
    __slots__ = ("query", "offset", "limit")
    QUERY_FIELD_NUMBER: _ClassVar[int]
    OFFSET_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    query: str
    offset: int
    limit: int
    def __init__(self, query: _Optional[str] = ..., offset: _Optional[int] = ..., limit: _Optional[int] = ...) -> None: ...

class SearchResponse(_message.Message):
    __slots__ = ("post_ids", "total")
    POST_IDS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_FIELD_NUMBER: _ClassVar[int]
    post_ids: _containers.RepeatedScalarFieldContainer[str]
    total: int
    def __init__(self, post_ids: _Optional[_Iterable[str]] = ..., total: _Optional[int] = ...) -> None: ...

class RelatedRequest(_message.Message):
    __slots__ = ("post_id", "limit")
    POST_ID_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    post_id: str
    limit: int
    def __init__(self, post_id: _Optional[str] = ..., limit: _Optional[int] = ...) -> None: ...

class RelatedResponse(_message.Message):
    __slots__ = ("post_ids",)
    POST_IDS_FIELD_NUMBER: _ClassVar[int]
    post_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, post_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class EmbedRequest(_message.Message):
    __slots__ = ("text",)
    TEXT_FIELD_NUMBER: _ClassVar[int]
    text: str
    def __init__(self, text: _Optional[str] = ...) -> None: ...

class EmbedResponse(_message.Message):
    __slots__ = ("vector",)
    VECTOR_FIELD_NUMBER: _ClassVar[int]
    vector: _containers.RepeatedScalarFieldContainer[float]
    def __init__(self, vector: _Optional[_Iterable[float]] = ...) -> None: ...

class ChatMessage(_message.Message):
    __slots__ = ("role", "content")
    ROLE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    role: str
    content: str
    def __init__(self, role: _Optional[str] = ..., content: _Optional[str] = ...) -> None: ...

class ChatAnswerRequest(_message.Message):
    __slots__ = ("query", "history", "top_k")
    QUERY_FIELD_NUMBER: _ClassVar[int]
    HISTORY_FIELD_NUMBER: _ClassVar[int]
    TOP_K_FIELD_NUMBER: _ClassVar[int]
    query: str
    history: _containers.RepeatedCompositeFieldContainer[ChatMessage]
    top_k: int
    def __init__(self, query: _Optional[str] = ..., history: _Optional[_Iterable[_Union[ChatMessage, _Mapping]]] = ..., top_k: _Optional[int] = ...) -> None: ...

class ChatChunk(_message.Message):
    __slots__ = ("delta", "done", "cited_post_ids", "error")
    DELTA_FIELD_NUMBER: _ClassVar[int]
    DONE_FIELD_NUMBER: _ClassVar[int]
    CITED_POST_IDS_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    delta: str
    done: bool
    cited_post_ids: _containers.RepeatedScalarFieldContainer[str]
    error: str
    def __init__(self, delta: _Optional[str] = ..., done: _Optional[bool] = ..., cited_post_ids: _Optional[_Iterable[str]] = ..., error: _Optional[str] = ...) -> None: ...
