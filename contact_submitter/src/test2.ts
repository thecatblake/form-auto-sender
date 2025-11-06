import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { acquireContext, releaseContext } from "./browserPool";
import { chromium } from "playwright";
import { fillFields, mapFields, SubmitPayload } from "./mapper";
import { findFormCandidates } from "./detector";
import { neutralizeOverlays, screenshotOnFail } from "./utils";
import { waitForSuccess } from "./verifier";

class QpsLimiter {
  private capacity: number;
  private tokens: number;
  private queue: Array<() => void> = [];
  private timer: NodeJS.Timeout;

  constructor(qps: number) {
    if (qps <= 0) throw new Error("qps must be > 0");
    this.capacity = qps;
    this.tokens = qps;
    const interval = Math.max(1, Math.floor(1000 / qps)); // 毎 interval ms で1トークン補充
    this.timer = setInterval(() => {
      if (this.tokens < this.capacity) this.tokens++;
      while (this.tokens > 0 && this.queue.length > 0) {
        this.tokens--;
        const resolve = this.queue.shift()!;
        resolve();
      }
    }, interval);
  }

  async take() {
    if (this.tokens > 0) {
      this.tokens--;
      return;
    }
    await new Promise<void>((res) => this.queue.push(res));
  }

  stop() {
    clearInterval(this.timer);
    // 残ってる待機は解放（終了時のリーク防止）
    this.queue.splice(0).forEach((res) => res());
  }
}

const QPS = 0.1;
const limiter = new QpsLimiter(QPS);

const payload: SubmitPayload = {
  // 氏名
  name: "山田 太郎",
  sei: "山田",
  mei: "太郎",
  sei_kana: "ヤマダ",
  mei_kana: "タロウ",

  // 企業
  company: "株式会社サンプル",
  department: "営業部",
  title: "課長",

  // 連絡
  email: "taro.yamada@example.com",
  phone: "03-1234-5678",
  phone_parts: ["03", "1234", "5678"],

  // 住所
  zip: "100-0001",
  prefecture: "東京都",
  address1: "千代田区千代田1-1",
  address2: "サンプルビル101",

  // 問い合わせ
  subject: "資料請求について",
  message: "御社サービスの資料を拝見したくご連絡いたしました。",
  type: "資料請求",

  // 同意
  agree: true,
};

const input = "urls.txt";
const inStream = fs.createReadStream(path.resolve(process.cwd(), input), { encoding: "utf8" });
const rl = readline.createInterface({ input: inStream, crlfDelay: Infinity });

type DiscoverResult = {
  url: string,
  score: number,
  positives: string[],
  negatives: string[],
  status: number,
  content_type: string,
  size: number
}

type DiscoverRes = {
  root_url: string,
  tried: number,
  fetched: number,
  results_top: DiscoverResult[]
}

const progress = {
  "success": 0,
  "maybe": 0,
  "fail": 0
}

rl.on("line", async (line) => {
  
  await limiter.take();
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-extensions",
      // "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--mute-audio",
      "--no-first-run",
      "--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaSessionService,InterestCohort",
    ],
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,   // 証明書系で詰まる場合の保険
  });

  try {
    const url = new URL(line.replace("\"", "").split(",")[0]);
    const root_url = url.protocol + "//" + url.host;

    const discover_req = {
      root_url,
      top_n: 5
    }

    const discover_res = await fetch(
      "http://localhost:8080/discover",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(discover_req)
      }
    )

    const discover_result: DiscoverRes = await discover_res.json();
    

    for (const result of discover_result.results_top) {
      const page = await browser?.newPage();
      await page?.goto(result.url, {
        waitUntil: "networkidle",
        timeout: 600000
      });

      const candidates = await findFormCandidates(page);

      // console.log(`${candidates.length} candidates found`)

      for (const candidate of candidates) {
          const root = candidate.root;
          const map = await mapFields(root);
          // console.log("field mapped")
          // if (!map.email || !map.message || !map.submit) continue;
    
          await fillFields(map, payload);
    
          await neutralizeOverlays(page);
          try { await map.submit!.click({ force: true }); } catch {}
          try { await page.keyboard.press("Enter"); } catch {}
    
          try {
            await waitForSuccess(page, { timeoutMs: 12_000, settleMs: 500 });
          } catch {
            await neutralizeOverlays(page);
            try { await map.submit!.click({ force: true }); } catch {}
          }
        
          // console.log("form sent");

          screenshotOnFail(page, result.url);
    
          const verdict = await waitForSuccess(page, { timeoutMs: 12_000, settleMs: 500 });
          progress[verdict]++;
      }

      await page.close();
    }
  } catch(e) {
    // console.error(e)
    console.log(e)
  } finally {
    process.stdout.write(`\rsuccess: ${progress.success}, maybe: ${progress.maybe}, fail: ${progress.fail}`);
    await context.close();
    await browser.close();
  }
});