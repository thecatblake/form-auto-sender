from typing import Optional
from form_auto_sender.models import Form, FormField
import copy
from sklearn.metrics.pairwise import cosine_similarity
from .embedding import EmbeddingRetriever
from .instance import DEFAULT_RETRIEVER
from form_auto_sender.contact import CONTACT_EXPANSION

def match(form: Form, key: str, value: str) -> Optional[FormField]:
    field = heuristic_match(form, expansion=CONTACT_EXPANSION, key=key, value=value)
    if field is not None:
        return field
    field = similarity_match(form, key, value, threshold=0.5)
    return field

def heuristic_match(form: Form, expansion: dict[str, str], key: str, value: str) -> Optional[FormField]:
    for field in form.fields:
        names = expansion.get(key, [])
        names.append(key)
        for name in names:
            if field.name == name:
                new_field = copy.copy(field)
                new_field.value = value
                return new_field
    return None

def similarity_match(form: Form, key: str, value: str, retriever: EmbeddingRetriever = DEFAULT_RETRIEVER, threshold: float = 0.1) -> Optional[FormField]:
    similar_field = None
    similarity = 0
    for field in form.fields:
        vec1 = retriever.retrieve(field.name)
        vec2 = retriever.retrieve(key)
        _similarity = cosine_similarity(vec1, vec2)

        if _similarity > similarity and _similarity > threshold:
            similar_field = copy.copy(field)
            similar_field.value = value
    return similar_field