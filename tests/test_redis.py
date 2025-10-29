import os, time, json, argparse, threading
from typing import List, Dict, Any, Optional
from urllib.parse import urlparse
import pandas as pd
import requests
import redis
from concurrent.futures import ThreadPoolExecutor, as_completed

DISCOVER_DEFAULT_URL = "http://localhost:8080/discover"

# ---------- CSV ----------
def read_urls(path: str) -> List[str]:
    df = pd.read_csv(path, header=0)
    col = None
    for c in df.columns:
        if c.strip().lower() in ("url", "link", "target"):
            col = c
            break
    if col is None:
        col = df.columns[0]
    return [str(u).strip() for u in df[col].dropna().tolist() if str(u).strip()]

def is_root_like(u: str) -> bool:
    try:
        p = urlparse(u)
        return bool(p.scheme and p.netloc)
    except Exception:
        return False

# ---------- HTTP (thread-local Session) ----------
_tls = threading.local()

def get_session() -> requests.Session:
    s = getattr(_tls, "session", None)
    if s is None:
        s = requests.Session()
        s.headers.update({"Accept": "application/json"})
        _tls.session = s
    return s

def discover_contacts(
    endpoint: str,
    root_url: str,
    fetch_limit: int,
    top_n: int,
    concurrency: int,
    sitemap_url_limit: int,
    timeout: float
) -> List[Dict[str, Any]]:
    payload = {
        "root_url": root_url,
        "fetch_limit": fetch_limit,
        "top_n": top_n,
        "concurrency": concurrency,
        "sitemap_url_limit": sitemap_url_limit,
    }
    sess = get_session()
    r = sess.post(endpoint, json=payload, timeout=timeout)
    r.raise_for_status()
    data = r.json()
    return data.get("results_top", []) or []

# ---------- Redis ----------
def ensure_group(r: redis.Redis, stream: str, group: str):
    try:
        r.xgroup_create(name=stream, groupname=group, id="$", mkstream=True)
        print(f"[info] group created: stream={stream} group={group}")
    except redis.ResponseError as e:
        if "BUSYGROUP" in str(e):
            print(f"[info] group exists: stream={stream} group={group}")
        else:
            raise

# ---------- Main ----------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True, help="入力CSV（URL/link/target カラム推奨）")
    ap.add_argument("--discover-url", default=DISCOVER_DEFAULT_URL, help=f"Discover API エンドポイント（デフォ={DISCOVER_DEFAULT_URL}）")
    ap.add_argument("--threshold", type=int, default=50, help="scoreしきい値（デフォ=50）")
    ap.add_argument("--top", type=int, default=1, help="各rootでしきい値通過の上位何件を投入（デフォ=1）")

    # Rust discover パラメータ
    ap.add_argument("--fetch-limit", type=int, default=80)
    ap.add_argument("--top-n", type=int, default=20)
    ap.add_argument("--disc-concurrency", type=int, default=4)
    ap.add_argument("--sitemap-url-limit", type=int, default=500)
    ap.add_argument("--http-timeout", type=float, default=25.0)

    # 並列
    ap.add_argument("--workers", type=int, default=32, help="並列スレッド数（デフォ=32）")

    # Redis
    ap.add_argument("--stream", default="jobs")
    ap.add_argument("--group", default="workers")
    ap.add_argument("--create-group", action="store_true")
    ap.add_argument("--batch", type=int, default=1000, help="XADDパイプラインflush間隔")
    ap.add_argument("--maxlen", type=int, default=0, help="MAXLEN（0=無制限）")
    ap.add_argument("--payload-json", default="", help='固定payload(JSON)。未指定ならデフォの営業用payload')

    args = ap.parse_args()

    redis_url = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
    r = redis.Redis.from_url(redis_url, decode_responses=True)
    print(f"[info] redis={redis_url}")

    urls = read_urls(args.csv)
    roots = []
    for u in urls:
        roots.append(u if is_root_like(u) else "https://" + u)
    # 重複排除
    roots = list(dict.fromkeys(roots))
    total_roots = len(roots)
    if total_roots == 0:
        print("[warn] URLが0件です。終了。")
        return

    if args.create_group:
        ensure_group(r, args.stream, args.group)

    default_payload = {
        "name": "山田 太郎",
        "sei": "ヤマダ",
        "mei": "タロウ",
        "sei_kana": "ヤマダ",
        "mei_kana": "タロウ",
        "company": "株式会社ストリーム",
        "email": "sales@stream-data.co.jp",
        "phone": "03-1234-5678",
        "subject": "お問い合わせ（御社サービスのご提案）",
        "message": "はじめまして。御社サイトを拝見し、集客とCV改善に関するご提案が可能と考えご連絡しました。具体的な改善案のドラフトを無償提供できます。オンラインで15分だけお時間いただけませんか？",
        "agree": True,
    }
    payload = default_payload if not args.payload_json else json.loads(args.payload_json)

    print(f"[info] discover start: roots={total_roots} workers={args.workers} thr={args.threshold} top={args.top} endpoint={args.discover-url if hasattr(args,'discover-url') else args.discover_url}")

    t0 = time.perf_counter()
    sent = 0
    finished = 0

    # Redis pipeline はスレッド非安全なので、メインスレッドでまとめてflush
    pipe = r.pipeline(transaction=False)

    def submit(job_fields: Dict[str, str]):
        nonlocal sent
        if args.maxlen > 0:
            pipe.xadd(args.stream, job_fields, maxlen=args.maxlen, approximate=True)
        else:
            pipe.xadd(args.stream, job_fields)
        sent += 1
        if (sent % args.batch) == 0:
            pipe.execute()
            print(f"[info] enqueued={sent}")

    # スレッドワーカー
    def task(root: str) -> Optional[List[Dict[str, Any]]]:
        try:
            items = discover_contacts(
                endpoint=args.discover_url,
                root_url=root,
                fetch_limit=args.fetch_limit,
                top_n=args.top_n,
                concurrency=args.disc_concurrency,
                sitemap_url_limit=args.sitemap_url_limit,
                timeout=args.http_timeout,
            )
            # フィルタ & sort
            cand = [x for x in items if int(x.get("score", 0)) >= args.threshold]
            cand.sort(key=lambda x: int(x.get("score", 0)), reverse=True)
            return [{"root": root, **x} for x in cand[: max(1, args.top)]]
        except Exception as e:
            return [{"root": root, "error": str(e)}]

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(task, root): root for root in roots}
        for fut in as_completed(futs):
            finished += 1
            result = fut.result()
            if not result:
                print(f"[warn] discover empty root={futs[fut]}")
                continue

            # 失敗（HTTPなど）
            if isinstance(result, list) and "error" in result[0]:
                print(f"[warn] discover failed root={result[0]['root']} err={result[0]['error']}")
                continue

            # 成功: XADD （メインスレッドで）
            for item in result:
                contact_url = item.get("url")
                if not contact_url: 
                    continue
                job = {
                    "url": contact_url,
                    "payload": payload,
                    "root": item.get("root"),
                    "score": int(item.get("score", 0))
                }
                fields = {"job": json.dumps(job, ensure_ascii=False)}
                submit(fields)

            if finished % 10 == 0:
                pipe.execute()
                print(f"[info] progress roots={finished}/{total_roots} enqueued={sent}")

    # 残りflush
    pipe.execute()
    dt = time.perf_counter() - t0
    rate = sent / dt if dt > 0 else 0.0
    print(f"[done] roots={total_roots} enqueued={sent} time={dt:.2f}s rate={rate:.1f} msg/s")

    try:
        xlen = r.xlen(args.stream)
        print(f"[info] XLEN {args.stream} = {xlen}")
    except Exception as e:
        print(f"[warn] XLEN failed: {e}")

if __name__ == "__main__":
    main()
