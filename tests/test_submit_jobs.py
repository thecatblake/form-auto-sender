import asyncio
import aiohttp
import csv

API_URL = "http://35.77.221.61:3000/submit"

CSV_PATH = "data.csv"  # ★ 読み込むCSVファイル名
CONCURRENCY = 10  # ★ 同時リクエスト数
RETRIES = 3  # ★ 失敗時のリトライ回数


async def send_url(session, idx, total, url, profile_id):
    """1つのURLに対して、リトライ付きでPOSTする"""
    payload = {
        "profile_id": profile_id,
        "url": url,
    }

    for attempt in range(1, RETRIES + 1):
        try:
            async with session.post(API_URL, json=payload) as res:
                status = res.status
                # 2xx を成功とみなす
                if 200 <= status < 300:
                    print(f"[{idx}/{total}] {url} ({profile_id}) → ✅ {status}")
                    return True
                else:
                    print(
                        f"[{idx}/{total}] {url} ({profile_id}) → ❌ {status} (attempt {attempt})"
                    )
        except Exception as e:
            print(
                f"[{idx}/{total}] {url} ({profile_id}) → 💥 error: {e} (attempt {attempt})"
            )

        # 失敗したら少し待ってリトライ
        await asyncio.sleep(1.0)

    # 全リトライ失敗
    print(f"[{idx}/{total}] {url} ({profile_id}) → ❌ FAILED after {RETRIES} attempts")
    return False


async def main():
    # --- CSV 読み込み ---
    # CSV はヘッダ付きで、少なくとも "url", "profile_id" カラムがある前提
    rows = []
    with open(CSV_PATH, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            url = (row.get("url") or "").strip()
            profile_id = (row.get("id") or "").strip()
            # 必須項目がそろっている行だけ使う
            if url and profile_id:
                rows.append((url, profile_id))

    total = len(rows)
    print(f"Total {total} rows from CSV.")

    # 同時接続数制限用セマフォ
    sem = asyncio.Semaphore(CONCURRENCY)

    timeout = aiohttp.ClientTimeout(total=15)
    connector = aiohttp.TCPConnector(limit=CONCURRENCY)

    async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:

        async def runner(idx, url, profile_id):
            async with sem:
                return await send_url(session, idx, total, url, profile_id)

        tasks = [
            asyncio.create_task(runner(idx, url, profile_id))
            for idx, (url, profile_id) in enumerate(rows, 1)  # ★ 上から順に処理
        ]

        # どれかで例外が出ても他を止めないようにする
        finished = await asyncio.gather(*tasks, return_exceptions=True)

        # 成功/失敗集計
        success = 0
        fail = 0
        for r in finished:
            if isinstance(r, Exception):
                fail += 1
            elif r:
                success += 1
            else:
                fail += 1

        print(f"\nDone. ✅ success={success}, ❌ fail={fail}")


if __name__ == "__main__":
    asyncio.run(main())
