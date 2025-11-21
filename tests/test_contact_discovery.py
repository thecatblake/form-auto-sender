#!/usr/bin/env python3
"""
Bulk scorer for contact-scoring API.

- Reads URLs (one per line) from a text file
- Calls POST {endpoint}/score with {"url": "..."} concurrently
- Writes results as JSONL (default) or CSV

Usage:
  python bulk_score.py --input urls.txt --out results.jsonl
  python bulk_score.py --input urls.txt --out results.csv --format csv --concurrency 50
"""

import argparse
import asyncio
import aiohttp
import json
import csv
import sys
from urllib.parse import urlparse
from typing import Any, Dict, List, Optional

DEFAULT_ENDPOINT = "http://localhost:8080/score"

def load_urls(path: str) -> List[str]:
    urls = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            u = line.strip()
            if not u:
                continue
            # ざっくりURLバリデーション（スキーム省略を補完したい場合はここで処理）
            if "://" not in u:
                u = "http://" + u  # 必要なら https に変更
            urls.append(u)
    # 重複は削る（順序は保持）
    seen = set()
    uniq = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            uniq.append(u)
    return uniq

async def fetch_score(
    session: aiohttp.ClientSession,
    endpoint: str,
    url: str,
    timeout_s: float,
    retries: int,
    semaphore: asyncio.Semaphore,
) -> Dict[str, Any]:
    """
    POST {endpoint} with {"url": url}
    Retries with exponential backoff + jitter.
    """
    payload = {"url": url}
    attempt = 0
    backoff = 0.5  # seconds

    async with semaphore:
        while True:
            attempt += 1
            try:
                async with session.post(
                    endpoint,
                    json=payload,
                    timeout=timeout_s,
                ) as resp:
                    # APIはJSONを返す想定
                    data = await resp.json(content_type=None)
                    # 応答にURLが含まれないケースでも自分のURLを付加
                    if isinstance(data, dict) and "url" not in data:
                        data["url"] = url
                    return data
            except asyncio.TimeoutError:
                err = f"timeout after {timeout_s}s"
            except aiohttp.ClientError as e:
                err = f"client_error: {e!r}"
            except Exception as e:  # 予期せぬエラー
                err = f"error: {e!r}"

            if attempt > retries:
                return {
                    "url": url,
                    "status": 0,
                    "domain": None,
                    "content_type": None,
                    "size": 0,
                    "is_html": False,
                    "score": None,
                    "positives": None,
                    "negatives": None,
                    "note": f"{err} (retries_exceeded)",
                }

            # backoff + jitter
            jitter = 0.1 * attempt
            wait_s = backoff + jitter
            await asyncio.sleep(wait_s)
            backoff *= 2
            if backoff > 8:
                backoff = 8  # 上限

async def run(
    input_path: str,
    out_path: str,
    endpoint: str,
    concurrency: int,
    timeout_s: float,
    retries: int,
    fmt: str,
) -> None:
    urls = load_urls(input_path)
    if not urls:
        print("No URLs found in input.", file=sys.stderr)
        return

    connector = aiohttp.TCPConnector(limit=concurrency)
    timeout = aiohttp.ClientTimeout(total=None)  # 個別でPOSTのtimeout_sを使う
    headers = {
        "content-type": "application/json",
        "accept": "application/json",
    }

    sem = asyncio.Semaphore(concurrency)

    async with aiohttp.ClientSession(
        connector=connector, timeout=timeout, headers=headers
    ) as session:
        tasks = [
            asyncio.create_task(
                fetch_score(session, endpoint, u, timeout_s, retries, sem)
            )
            for u in urls
        ]

        if fmt.lower() == "jsonl":
            with open(out_path, "w", encoding="utf-8") as fw:
                for coro in asyncio.as_completed(tasks):
                    res = await coro
                    fw.write(json.dumps(res, ensure_ascii=False) + "\n")
        elif fmt.lower() == "csv":
            # CSV用に主要フィールドを整形
            fieldnames = [
                "url",
                "status",
                "domain",
                "content_type",
                "size",
                "is_html",
                "score",
                "positives",
                "negatives",
                "note",
            ]
            with open(out_path, "w", encoding="utf-8", newline="") as fw:
                writer = csv.DictWriter(fw, fieldnames=fieldnames)
                writer.writeheader()
                for coro in asyncio.as_completed(tasks):
                    res = await coro
                    row = {k: res.get(k) for k in fieldnames}
                    # リストはJSON文字列化して1セルに入れる
                    if isinstance(row.get("positives"), list):
                        row["positives"] = json.dumps(row["positives"], ensure_ascii=False)
                    if isinstance(row.get("negatives"), list):
                        row["negatives"] = json.dumps(row["negatives"], ensure_ascii=False)
                    writer.writerow(row)
        else:
            raise ValueError("--format must be 'jsonl' or 'csv'")

def main():
    p = argparse.ArgumentParser(description="Call /score API for URLs listed in a file.")
    p.add_argument("--input", required=True, help="Path to a text file (one URL per line).")
    p.add_argument("--out", required=True, help="Output file path (.jsonl or .csv).")
    p.add_argument("--endpoint", default=DEFAULT_ENDPOINT, help=f"API endpoint (default: {DEFAULT_ENDPOINT})")
    p.add_argument("--concurrency", type=int, default=40, help="Number of concurrent requests (default: 40)")
    p.add_argument("--timeout", type=float, default=30.0, help="Per-request timeout seconds (default: 30)")
    p.add_argument("--retries", type=int, default=2, help="Retry count on failure (default: 2)")
    p.add_argument("--format", choices=["jsonl", "csv"], default="jsonl", help="Output format (default: jsonl)")
    args = p.parse_args()

    try:
        asyncio.run(run(
            input_path=args.input,
            out_path=args.out,
            endpoint=args.endpoint.rstrip("/"),
            concurrency=args.concurrency,
            timeout_s=args.timeout,
            retries=args.retries,
            fmt=args.format,
        ))
    except KeyboardInterrupt:
        print("Interrupted.", file=sys.stderr)
        sys.exit(130)

if __name__ == "__main__":
    main()
