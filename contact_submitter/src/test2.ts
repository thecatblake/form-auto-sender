import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { acquireContext, releaseContext } from "./browserPool";
import { chromium } from "playwright";

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

const QPS = 10;
const limiter = new QpsLimiter(QPS);

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
      console.log("page loaded");
      await page.close();
    }
  } catch(e) {
    console.error(e)
  } finally {
    await context.close();
    await browser.close();
  }
});