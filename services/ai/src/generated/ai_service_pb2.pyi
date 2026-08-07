from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable
from typing import ClassVar as _ClassVar, Optional as _Optional

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
