from abc import ABC, abstractmethod
from typing import Any, Optional
import redis

class Cache(ABC):
    @abstractmethod
    def get(self, key: str) -> Optional[Any]:
        """
        Retrieves a value from the cache given its key.

        Args:
            key (str): The key of the item to retrieve.

        Returns:
            Optional[Any]: The value associated with the key, or None if the key is not found.
        """
        pass

    @abstractmethod
    def set(self, key: str, value: Any, ttl: Optional[int] = None) -> None:
        """
        Stores a key-value pair in the cache.

        Args:
            key (str): The key to store.
            value (Any): The value to store.
            ttl (Optional[int]): Time-to-live in seconds. If None, the item
                                  will not expire (or use the default cache policy).
        """
        pass

    @abstractmethod
    def delete(self, key: str) -> None:
        """
        Deletes a key-value pair from the cache.

        Args:
            key (str): The key of the item to delete.
        """
        pass

class InMemoryCache(Cache):
    def __init__(self):
        self._cache: dict[str, Any] = {}

    def get(self, key: str) -> Optional[Any]:
        value = self._cache.get(key)
        return value

    def set(self, key: str, value: Any, ttl: Optional[int] = None) -> None:
        self._cache[key] = value

    def delete(self, key: str) -> None:
        if key in self._cache:
            del self._cache[key]

class RedisCache(Cache):
    def __init__(self, redis_client: redis.Redis):
        self._redis = redis_client
        try:
            self._redis.ping()
        except redis.exceptions.ConnectionError as e:
            raise

    def get(self, key: str) -> Optional[Any]:
        value = self._redis.get(key)
        if value:
            decoded_value = value
            return decoded_value
        else:
            return None

    def set(self, key: str, value: Any, ttl: Optional[int] = None) -> None:
        if ttl:
            self._redis.set(key, str(value), ex=ttl)
        else:
            self._redis.set(key, str(value))

    def delete(self, key: str) -> None:
        self._redis.delete(key)
