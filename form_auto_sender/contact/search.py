from typing import List
from urllib.parse import urljoin
import requests

from .constants import HEURISTIC_CONTACT_PATH

def search_contact(host: str) -> List[str]:
    return heuristic_search_contact(host)

def heuristic_search_contact(host: str) -> List[str]:
    urls = []
    for path in HEURISTIC_CONTACT_PATH:
        url = urljoin(host, path)
        try:
            res = requests.get(url)
            if len(res.history) > 1:
                continue
            if res.status_code == 200:
                urls.append(url)
            res.raise_for_status()
        except:
            continue
    return urls
