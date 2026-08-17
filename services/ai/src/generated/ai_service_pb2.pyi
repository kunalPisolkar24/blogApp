import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class InteractionKind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    INTERACTION_KIND_UNSPECIFIED: _ClassVar[InteractionKind]
    INTERACTION_KIND_VIEW: _ClassVar[InteractionKind]
    INTERACTION_KIND_LIKE: _ClassVar[InteractionKind]
    INTERACTION_KIND_SAVE: _ClassVar[InteractionKind]

class RecommendMode(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    RECOMMEND_MODE_UNSPECIFIED: _ClassVar[RecommendMode]
    RECOMMEND_MODE_DEFAULT: _ClassVar[RecommendMode]
    RECOMMEND_MODE_SURPRISE: _ClassVar[RecommendMode]
INTERACTION_KIND_UNSPECIFIED: InteractionKind
INTERACTION_KIND_VIEW: InteractionKind
INTERACTION_KIND_LIKE: InteractionKind
INTERACTION_KIND_SAVE: InteractionKind
RECOMMEND_MODE_UNSPECIFIED: RecommendMode
RECOMMEND_MODE_DEFAULT: RecommendMode
RECOMMEND_MODE_SURPRISE: RecommendMode

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
    created_at: _timestamp_pb2.Timestamp
    def __init__(self, post_id: _Optional[str] = ..., title: _Optional[str] = ..., body: _Optional[str] = ..., summary: _Optional[str] = ..., tags: _Optional[_Iterable[str]] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

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
    __slots__ = ("post_ids", "total")
    POST_IDS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_FIELD_NUMBER: _ClassVar[int]
    post_ids: _containers.RepeatedScalarFieldContainer[str]
    total: int
    def __init__(self, post_ids: _Optional[_Iterable[str]] = ..., total: _Optional[int] = ...) -> None: ...

class RelatedBatchRequest(_message.Message):
    __slots__ = ("post_ids", "limit")
    POST_IDS_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    post_ids: _containers.RepeatedScalarFieldContainer[str]
    limit: int
    def __init__(self, post_ids: _Optional[_Iterable[str]] = ..., limit: _Optional[int] = ...) -> None: ...

class RelatedBatchItem(_message.Message):
    __slots__ = ("post_id", "related_post_ids", "total")
    POST_ID_FIELD_NUMBER: _ClassVar[int]
    RELATED_POST_IDS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_FIELD_NUMBER: _ClassVar[int]
    post_id: str
    related_post_ids: _containers.RepeatedScalarFieldContainer[str]
    total: int
    def __init__(self, post_id: _Optional[str] = ..., related_post_ids: _Optional[_Iterable[str]] = ..., total: _Optional[int] = ...) -> None: ...

class RelatedBatchResponse(_message.Message):
    __slots__ = ("results",)
    RESULTS_FIELD_NUMBER: _ClassVar[int]
    results: _containers.RepeatedCompositeFieldContainer[RelatedBatchItem]
    def __init__(self, results: _Optional[_Iterable[_Union[RelatedBatchItem, _Mapping]]] = ...) -> None: ...

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

class UserProfileUpdateRequest(_message.Message):
    __slots__ = ("user_id", "post_id", "kind")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    POST_ID_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    post_id: str
    kind: InteractionKind
    def __init__(self, user_id: _Optional[str] = ..., post_id: _Optional[str] = ..., kind: _Optional[_Union[InteractionKind, str]] = ...) -> None: ...

class UserProfileUpdateResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class RecommendRequest(_message.Message):
    __slots__ = ("user_id", "offset", "limit", "mode", "seed")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    OFFSET_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    MODE_FIELD_NUMBER: _ClassVar[int]
    SEED_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    offset: int
    limit: int
    mode: RecommendMode
    seed: int
    def __init__(self, user_id: _Optional[str] = ..., offset: _Optional[int] = ..., limit: _Optional[int] = ..., mode: _Optional[_Union[RecommendMode, str]] = ..., seed: _Optional[int] = ...) -> None: ...

class RecommendResponse(_message.Message):
    __slots__ = ("post_ids", "total")
    POST_IDS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_FIELD_NUMBER: _ClassVar[int]
    post_ids: _containers.RepeatedScalarFieldContainer[str]
    total: int
    def __init__(self, post_ids: _Optional[_Iterable[str]] = ..., total: _Optional[int] = ...) -> None: ...

class DeleteUserProfileRequest(_message.Message):
    __slots__ = ("user_id",)
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    def __init__(self, user_id: _Optional[str] = ...) -> None: ...

class DeleteUserProfileResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...
