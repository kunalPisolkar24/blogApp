# Hand-maintained type stub for the generated gRPC module.
#
# grpc_tools does not emit .pyi files for --grpc_python_out, and the generated
# code assigns RPC methods dynamically, which type checkers cannot see.
# Regenerate ai_service_pb2_grpc.py with `make generate`; keep this file in
# sync with ai_service.proto by hand.

from typing import Any

import grpc

from . import ai_service_pb2


class AIServiceStub:
    def __init__(self, channel: grpc.aio.Channel) -> None: ...

    GenerateSummary: grpc.aio.UnaryUnaryMultiCallable[
        ai_service_pb2.ContentRequest, ai_service_pb2.ContentResponse
    ]
    GenerateTags: grpc.aio.UnaryUnaryMultiCallable[
        ai_service_pb2.ContextRequest, ai_service_pb2.TagsResponse
    ]
    GeneratePost: grpc.aio.UnaryUnaryMultiCallable[
        ai_service_pb2.PostGenerationRequest, ai_service_pb2.PostGenerationResponse
    ]
    IndexPost: grpc.aio.UnaryUnaryMultiCallable[
        ai_service_pb2.IndexRequest, ai_service_pb2.IndexResponse
    ]
    DeletePost: grpc.aio.UnaryUnaryMultiCallable[
        ai_service_pb2.DeleteRequest, ai_service_pb2.DeleteResponse
    ]
    SearchPosts: grpc.aio.UnaryUnaryMultiCallable[
        ai_service_pb2.SearchRequest, ai_service_pb2.SearchResponse
    ]
    RelatedPosts: grpc.aio.UnaryUnaryMultiCallable[
        ai_service_pb2.RelatedRequest, ai_service_pb2.RelatedResponse
    ]
    RelatedPostsBatch: grpc.aio.UnaryUnaryMultiCallable[
        ai_service_pb2.RelatedBatchRequest, ai_service_pb2.RelatedBatchResponse
    ]
    Embed: grpc.aio.UnaryUnaryMultiCallable[
        ai_service_pb2.EmbedRequest, ai_service_pb2.EmbedResponse
    ]
    ChatAnswer: grpc.aio.UnaryStreamMultiCallable[
        ai_service_pb2.ChatAnswerRequest, ai_service_pb2.ChatChunk
    ]
    UpdateUserProfile: grpc.aio.UnaryUnaryMultiCallable[
        ai_service_pb2.UserProfileUpdateRequest,
        ai_service_pb2.UserProfileUpdateResponse,
    ]
    RecommendFeed: grpc.aio.UnaryUnaryMultiCallable[
        ai_service_pb2.RecommendRequest, ai_service_pb2.RecommendResponse
    ]
    DeleteUserProfile: grpc.aio.UnaryUnaryMultiCallable[
        ai_service_pb2.DeleteUserProfileRequest,
        ai_service_pb2.DeleteUserProfileResponse,
    ]


class AIServiceServicer:
    def GenerateSummary(self, request: Any, context: Any) -> Any: ...

    def GenerateTags(self, request: Any, context: Any) -> Any: ...

    def GeneratePost(self, request: Any, context: Any) -> Any: ...

    def IndexPost(self, request: Any, context: Any) -> Any: ...

    def DeletePost(self, request: Any, context: Any) -> Any: ...

    def SearchPosts(self, request: Any, context: Any) -> Any: ...

    def RelatedPosts(self, request: Any, context: Any) -> Any: ...

    def RelatedPostsBatch(self, request: Any, context: Any) -> Any: ...

    def Embed(self, request: Any, context: Any) -> Any: ...

    def ChatAnswer(self, request: Any, context: Any) -> Any: ...

    def UpdateUserProfile(self, request: Any, context: Any) -> Any: ...

    def RecommendFeed(self, request: Any, context: Any) -> Any: ...

    def DeleteUserProfile(self, request: Any, context: Any) -> Any: ...


def add_AIServiceServicer_to_server(
    servicer: AIServiceServicer, server: grpc.aio.Server
) -> None: ...