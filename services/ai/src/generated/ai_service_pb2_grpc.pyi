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


class AIServiceServicer:
    def GenerateSummary(self, request: Any, context: Any) -> Any: ...

    def GenerateTags(self, request: Any, context: Any) -> Any: ...

    def GeneratePost(self, request: Any, context: Any) -> Any: ...


def add_AIServiceServicer_to_server(
    servicer: AIServiceServicer, server: grpc.aio.Server
) -> None: ...
