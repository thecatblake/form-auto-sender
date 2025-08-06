from abc import ABC, abstractmethod
from typing import List, Optional
import numpy as np
import openai
from .cache import Cache

class Embedding(ABC):
    @abstractmethod
    def embed(self, text: str) -> List[float]:
        """
        Generates a numerical embedding (vector) for the given text.

        Args:
            text (str): The input text to embed.

        Returns:
            List[float]: A list of floats representing the embedding vector.
        """
        pass

class OpenAIEmbedding(Embedding):
    def __init__(self, api_key: str = "sk-dummy-api-key"):
        self.api_key = api_key
        openai.api_key = api_key

    def embed(self, text: str) -> List[float]:
        response = openai.embeddings.create(
            model="text-embedding-3-small",
            input=[text]
        )
        return response.data[0].embedding

class EmbeddingRetriever:
    """
    Retrieves embeddings, utilizing a cache to avoid redundant embedding generation.
    """

    def __init__(self, embedding_model: Embedding, cache: Cache):
        """
        Initializes the EmbeddingRetriever.

        Args:
            embedding_model (Embedding): An instance of an Embedding model (e.g., OpenAIEmbedding).
            cache (Cache): An instance of a Cache (e.g., InMemoryCache, RedisCache).
        """
        self.embedding_model = embedding_model
        self.cache = cache

    def retrieve(self, text: str, ttl: Optional[int] = None) -> List[float]:
        cache_key = f"embedding:{text}"
        embedding = self.cache.get(cache_key)

        if embedding is None:
            embedding = self.embedding_model.embed(text)
            if isinstance(embedding, np.ndarray):
                embedding = embedding.tolist()
            self.cache.set(cache_key, embedding, ttl=ttl)

        return embedding
