from redis import Redis
from form_auto_sender.matching.cache import RedisCache
from form_auto_sender.matching.embedding import EmbeddingRetriever, OpenAIEmbedding
import os

def test_openai_embedding():
    embedding = OpenAIEmbedding(
        api_key=os.environ.get("OPENAI_API_KEY")
    )
    client = Redis(
        host=os.environ.get("REDIS_HOST"),
        port=os.environ.get("REDIS_PORT"),
        decode_responses=True,
        username=os.environ.get("REDIS_USERNAME"),
        password=os.environ.get("REDIS_PASSWORD")
    )

    cache = RedisCache(
        redis_client=client
    )

    retriever = EmbeddingRetriever(
        embedding_model=embedding,
        cache=cache
    )

    res = retriever.retrieve("test")

    assert len(res) > 0