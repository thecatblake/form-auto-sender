# pipeline_submit.py
import os, time, json, argparse, threading, sys
from typing import List, Dict, Any, Optional, Tuple
from urllib.parse import urlparse
import pandas as pd
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import defaultdict, deque
import random

DISCOVER_DEFAULT_URL = "http://localhost:8080/discover"
SUBMIT_DEFAULT_URL   = "http://localhost:7070/submit"

# ---------- CSV ----------
def read_urls(path: str) -> List[str]:
    df = pd.read_csv(path, header=0)
    for c in df.columns:
        if c.strip().lower() in ("url", "link", "target"):
            col = c; break
    else:
        col = df.columns[0]
    return [str(u).strip() for u in df[col].dropna().tolist() if str(u).strip()]

def is_root_like(u: str) -> bool:
    try:
        p = urlparse(u)
        return bool(p.scheme and p.netloc and not p.path or p.path in ("/", ""))
    except Exception:
        return False

def get_host(u: str) -> str:
    try:
        return urlparse(u).hostname or ""
    except Exception:
        return ""

# ---------- HTTP (thread-local Session) ----------
_tls = threading.local()
def get_session() -> requests.Session:
    s = getattr(_tls, "session", None)
    if s is None:
        s = requests.Session()
        s.headers.update({"Accept": "application/json"})
        # リトライ（軽め）
        adapter = requests.adapters.HTTPAdapter(pool_connections=100, pool_maxsize=100)
        s.mount("http://", adapter)
        s.mount("https://", adapter)
        _tls.session = s
    return s

def discover_contacts(endpoint: str, root_url: str,
                      fetch_limit: int, top_n: int, concurrency: int,
                      sitemap_url_limit: int, timeout: float) -> List[Dict[str, Any]]:
    payload = {
        "root_url": root_url,
        "fetch_limit": fetch_limit,
        "top_n": top_n,
        "concurrency": concurrency,
        "sitemap_url_limit": sitemap_url_limit,
    }
    r = get_session().post(endpoint, json=payload, timeout=timeout)
    r.raise_for_status()
    data = r.json()
    return data.get("results_top", []) or []

def submit_one(submit_url: str, url: str, payload: Dict[str, Any], timeout: float = 120.0) -> Dict[str, Any]:
    body = {"url": url, "payload": payload}
    r = get_session().post(submit_url, json=body, timeout=timeout)
    r.raise_for_status()
    return r.json()

# ---------- Discover Stage ----------
def run_discover_stage(
    roots: List[str],
    *,
    discover_url: str,
    threshold: int,
    top: int,
    rust_fetch_limit: int,
    rust_top_n: int,
    rust_disc_concurrency: int,
    rust_sitemap_url_limit: int,
    http_timeout: float,
    disc_workers: int,
) -> List[Tuple[str, str, int]]:
    """
    returns: list of (root, contact_url, score)
    """
    lock = threading.Lock()
    counters = {"done":0, "ok":0, "fail":0, "contacts":0, "started": time.perf_counter()}
    out: List[Tuple[str,str,int]] = []

    def one(root: str) -> List[Tuple[str,str,int]]:
        try:
            items = discover_contacts(
                endpoint=discover_url,
                root_url=root,
                fetch_limit=rust_fetch_limit,
                top_n=rust_top_n,
                concurrency=rust_disc_concurrency,
                sitemap_url_limit=rust_sitemap_url_limit,
                timeout=http_timeout,
            )
            cand = [x for x in items if int(x.get("score", 0)) >= threshold]
            cand.sort(key=lambda x: int(x.get("score", 0)), reverse=True)
            if top > 0:
                cand = cand[:top]
            return [(root, x["url"], int(x.get("score", 0))) for x in cand if x.get("url")]
        except Exception:
            return None  # fail

    def progress():
        while True:
            time.sleep(0.5)
            with lock:
                d = counters["done"]; ok = counters["ok"]; fl = counters["fail"]; ct = counters["contacts"]
                rate = d / max(1e-9, (time.perf_counter() - counters["started"]))
                sys.stdout.write(f"\r[discover] {d}/{len(roots)} ok={ok} fail={fl} contacts={ct} | {rate:.1f} r/s")
                sys.stdout.flush()
                if d >= len(roots):
                    sys.stdout.write("\n"); sys.stdout.flush(); break

    t = threading.Thread(target=progress, daemon=True); t.start()

    with ThreadPoolExecutor(max_workers=disc_workers) as ex:
        futs = {ex.submit(one, r): r for r in roots}
        for fut in as_completed(futs):
            root = futs[fut]
            res = fut.result()
            with lock:
                counters["done"] += 1
                if res is None:
                    counters["fail"] += 1
                else:
                    counters["ok"] += 1
                    out.extend(res)
                    counters["contacts"] += len(res)

    t.join()
    return out

# ---------- Submit Stage（グローバル並列 + ドメイン直列） ----------
def run_submit_stage(
    contacts: List[Tuple[str, str, int]],
    *,
    submit_url: str,
    payload: Dict[str, Any],
    submit_workers: int,
    per_domain_parallel: int,
    submit_timeout: float,
    retry: int,
    retry_backoff: float,
    results_path: Optional[str] = "results.ndjson",
) -> Dict[str, int]:
    """
    contacts: list of (root, contact_url, score)
    """
    # domainセマフォ
    domain_limits: Dict[str, threading.Semaphore] = defaultdict(lambda: threading.Semaphore(per_domain_parallel))
    q = deque(contacts)

    lock = threading.Lock()
    counters = {"done":0, "total": len(contacts), "ok":0, "fail":0, "error":0, "started": time.perf_counter()}

    # 結果ログ（任意）
    res_fp = open(results_path, "a", encoding="utf-8") if results_path else None
    res_lock = threading.Lock()

    def worker():
        while True:
            with lock:
                if not q: return
                root, url, score = q.popleft()
            host = get_host(url)
            sem = domain_limits[host]
            with sem:
                attempts = 0
                while True:
                    try:
                        out = submit_one(submit_url, url, payload, timeout=submit_timeout)
                        st = (out.get("status") or "").lower()
                        with lock:
                            counters["done"] += 1
                            if st == "success":
                                counters["ok"] += 1
                            elif st == "fail":
                                counters["fail"] += 1
                            else:
                                counters["error"] += 1
                        if res_fp:
                            with res_lock:
                                res_fp.write(json.dumps({"root":root,"url":url,"score":score,"result":out}, ensure_ascii=False)+"\n")
                        break
                    except Exception as e:
                        if attempts < retry:
                            attempts += 1
                            time.sleep(retry_backoff * (2 ** (attempts-1)) + random.uniform(0, 0.5))
                            continue
                        with lock:
                            counters["done"] += 1
                            counters["error"] += 1
                        if res_fp:
                            with res_lock:
                                res_fp.write(json.dumps({"root":root,"url":url,"score":score,"error":str(e)}, ensure_ascii=False)+"\n")
                        break

    def progress():
        while True:
            time.sleep(0.5)
            with lock:
                d = counters["done"]; tot = counters["total"]
                ok = counters["ok"]; fl = counters["fail"]; er = counters["error"]
                rate = d / max(1e-9, (time.perf_counter() - counters["started"]))
                sys.stdout.write(f"\r[submit ] {d}/{tot} ok={ok} fail={fl} error={er} | {rate:.1f} r/s")
                sys.stdout.flush()
                if d >= tot:
                    sys.stdout.write("\n"); sys.stdout.flush(); break

    t = threading.Thread(target=progress, daemon=True); t.start()

    threads = [threading.Thread(target=worker, daemon=True) for _ in range(submit_workers)]
    for th in threads: th.start()
    for th in threads: th.join()
    t.join()
    if res_fp: res_fp.close()
    return counters

# ---------- Main ----------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)

    # Stage切替: 直接ContactのCSVなら --contacts-only
    ap.add_argument("--contacts-only", action="store_true", help="CSVが連絡先URLの一覧（discoverをスキップ）")

    # Discover
    ap.add_argument("--discover-url", default=DISCOVER_DEFAULT_URL)
    ap.add_argument("--threshold", type=int, default=50)
    ap.add_argument("--top", type=int, default=1)
    ap.add_argument("--fetch-limit", type=int, default=80)
    ap.add_argument("--top-n", type=int, default=20)
    ap.add_argument("--disc-concurrency", type=int, default=4)
    ap.add_argument("--sitemap-url-limit", type=int, default=500)
    ap.add_argument("--http-timeout", type=float, default=25.0)
    ap.add_argument("--disc-workers", type=int, default=64)

    # Submit
    ap.add_argument("--submit-url",   default=SUBMIT_DEFAULT_URL)
    ap.add_argument("--submit-workers", type=int, default=8, help="Submitのグローバル並列")
    ap.add_argument("--per-domain-parallel", type=int, default=1, help="ドメイン内並列（1で直列）")
    ap.add_argument("--submit-timeout", type=float, default=600.0)
    ap.add_argument("--submit-retry", type=int, default=1)
    ap.add_argument("--submit-retry-backoff", type=float, default=1.0)

    # payload
    ap.add_argument("--payload-json", default="")

    # 出力
    ap.add_argument("--results", default="results.ndjson")

    args = ap.parse_args()

    urls = read_urls(args.csv)
    if not urls:
        print("[warn] URLが0件です。終了。"); return

    # payload
    default_payload = {
        "name": "山田 太郎", "sei": "ヤマダ", "mei": "タロウ",
        "sei_kana": "ヤマダ", "mei_kナ": "タロウ",
        "company": "株式会社ストリーム", "email": "sales@stream-data.co.jp",
        "phone": "03-1234-5678",
        "subject": "お問い合わせ（御社サービスのご提案）",
        "message": "はじめまして。御社サイトを拝見し、集客とCV改善に関するご提案が可能と考えご連絡しました。具体的な改善案のドラフトを無償提供できます。オンラインで15分だけお時間いただけませんか？",
        "agree": True,
    }
    payload = default_payload if not args.payload_json else json.loads(args.payload_json)

    # ---------- Stage 1: Discover or direct contacts ----------
    if args.contacts_only:
        contacts = [(u, u, 100) for u in urls]  # rootをuのまま、score=100扱い
    else:
        roots = []
        for u in urls:
            roots.append(u if u.startswith("http") else "https://" + u)
        roots = list(dict.fromkeys(roots))
        print(f"[info] discover start roots={len(roots)} workers={args.disc_workers}")
        contacts = run_discover_stage(
            roots,
            discover_url=args.discover_url,
            threshold=args.threshold,
            top=args.top,
            rust_fetch_limit=args.fetch_limit,
            rust_top_n=args.top_n,
            rust_disc_concurrency=args.disc_concurrency,
            rust_sitemap_url_limit=args.sitemap_url_limit,
            http_timeout=args.http_timeout,
            disc_workers=args.disc_workers,
        )
    if not contacts:
        print("[done] contacts=0"); return

    # ---------- Stage 2: Submit ----------
    print(f"[info] submit start contacts={len(contacts)} workers={args.submit_workers} per-domain={args.per_domain_parallel}")
    s = run_submit_stage(
        contacts,
        submit_url=args.submit_url,
        payload=payload,
        submit_workers=args.submit_workers,
        per_domain_parallel=args.per_domain_parallel,
        submit_timeout=args.submit_timeout,
        retry=args.submit_retry,
        retry_backoff=args.submit_retry_backoff,
        results_path=args.results,
    )
    elapsed = time.perf_counter() - s["started"]
    print(f"[done] submit ok={s['ok']} fail={s['fail']} error={s['error']} | time={elapsed:.2f}s")

if __name__ == "__main__":
    main()
