from src.generated import ai_service_pb2_grpc


class AIService(ai_service_pb2_grpc.AIServiceServicer):
    """AI service RPC implementations. LLM wiring lands in a later phase."""
