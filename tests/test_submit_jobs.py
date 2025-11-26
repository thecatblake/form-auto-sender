import asyncio
import aiohttp

API_URL = "http://35.78.205.169:3000/submit"
PROFILE_ID = "e2f936bb-f38f-436f-af21-d75bdf76bc4e"

CONCURRENCY = 10   # ★ 同時リクエスト数（まずは小さめに）
RETRIES = 3       # ★ 失敗時のリトライ回数


async def send_url(session, idx, total, url):
    """1つのURLに対して、リトライ付きでPOSTする"""
    payload = {
        "profile_id": PROFILE_ID,
        "url": url,
    }

    for attempt in range(1, RETRIES + 1):
        try:
            async with session.post(API_URL, json=payload) as res:
                status = res.status
                # 2xx を成功とみなす
                if 200 <= status < 300:
                    print(f"[{idx}/{total}] {url} → ✅ {status}")
                    return True
                else:
                    print(f"[{idx}/{total}] {url} → ❌ {status} (attempt {attempt})")
        except Exception as e:
            print(f"[{idx}/{total}] {url} → 💥 error: {e} (attempt {attempt})")

        # 失敗したら少し待ってリトライ
        await asyncio.sleep(1.0)

    # 全リトライ失敗
    print(f"[{idx}/{total}] {url} → ❌ FAILED after {RETRIES} attempts")
    return False


async def main():
    # URL一覧読み込み
    with open("urls.txt", "r", encoding="utf-8") as f:
        urls = [line.strip() for line in f if line.strip()]

    total = len(urls)
    print(f"Total {total} urls.")

    # 同時接続数制限用セマフォ
    sem = asyncio.Semaphore(CONCURRENCY)

    timeout = aiohttp.ClientTimeout(total=15)
    connector = aiohttp.TCPConnector(limit=CONCURRENCY)

    async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
        results = []

        async def runner(idx, url):
            async with sem:
                return await send_url(session, idx, total, url)

        tasks = [
            asyncio.create_task(runner(idx, url))
            for idx, url in enumerate(urls, 1)
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
