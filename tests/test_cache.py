from form_auto_sender.matching.cache import RedisCache
from redis import Redis
import os

def test_redis_cache():
    client = Redis(
        host=os.environ.get("REDIS_HOST"),
        port=os.environ.get("REDIS_PORT"),
        decode_responses=True,
        username=os.environ.get("REDIS_USERNAME"),
        password=os.environ.get("REDIS_PASSWORD")
    )

    cache = RedisCache(redis_client=client)

    cache.set("test", "ok")

    v = cache.get("test")

    assert v is not None

    cache.delete("test")

    v = cache.get("test")

    assert v is None
