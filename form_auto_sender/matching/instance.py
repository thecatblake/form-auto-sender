from .cache import RedisCache
from .embedding import OpenAIEmbedding, EmbeddingRetriever
from redis import Redis
import os

redis_client = Redis(
    host=os.environ.get("REDIS_HOST"),
    port=os.environ.get("REDIS_PORT"),
    decode_responses=True,
    username=os.environ.get("REDIS_USERNAME"),
    password=os.environ.get("REDIS_PASSWORD")
)

DEFAULT_CACHE = RedisCache(
    redis_client=redis_client
)

DEFAULT_EMBEDDING = OpenAIEmbedding(
    api_key=os.environ.get("OPENAI_API_KEY")
)

DEFAULT_RETRIEVER = EmbeddingRetriever(
    embedding_model=DEFAULT_EMBEDDING,
    cache=DEFAULT_CACHE
)
