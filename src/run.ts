import fs from "fs";
import path from "path";
import { Worker } from "worker_threads";
import { URL as NodeURL } from "url";
import type { ContactData } from "./types";

// ---------------- Contact data presets ----------------
const contactDataB: ContactData = {
  sei: "福井",
  mei: "悠介",
  furigana_sei: "フクイ",
  furigana_mei: "ユウスケ",
  manager: "福井悠介",
  name: "福井悠介",
  furigana: "ふくいゆうすけ",
  kana: "フクイ ユウスケ",
  email: "partner@haluene.co.jp",
  phone: "0366340795",
  subject: "【アライアンスご提案】高圧電力の協業パートナーのご提案",
  message: `お問い合わせフォームより失礼いたします。

突然のご連絡をお許しください。
私どもは、高圧電力の供給および関連サービスを提供する企業でございます。

この度、貴社の事業拡大やお客様への付加価値向上に貢献できるパートナーシップを築ければと思い、ご連絡を差し上げました。

弊社は、法人のお客様に高圧電力での受電設備の買取り、再エネ供給などコスト削減と合わせて、安定供給のサポートを行っております。

貴社のお客様の省エネ化や経費削減の一助となるよう、貴社とのアライアンスを通じて相互のビジネス拡大を目指しております。
貴社にて、高圧電力や電力サービスを通じ、既存顧客への付加価値サービス強化や新たなお客様の創出にてご提案できたらと思います。つきまして、一度お話の機会を頂戴出来ますと幸いです。

ご興味をお持ちいただけました際には、お手数ですが、下記フォームよりご連絡いただけますと幸いです。
ご確認のほど、何卒よろしくお願い申し上げます。

〈問合せフォーム〉
https://haluene.co.jp/inquiry-partner-approach/`,
  company: "株式会社ハルエネ",
  department: "戦略推進部",
  prefecture: "東京都",
  post_code: "1710021",
  address: "豊島区西池袋一丁目4番10号光ウエストゲートビル3F",
};

// ---------------- Utilities ----------------
function prepareContactUrls(filePath: string): string[] {
  const raw = fs.readFileSync(filePath, "utf8").trim().split(/\r?\n/);
  const urls = raw
    .map((line) => {
      try {
        const u = new NodeURL(line);
        return `${u.protocol}//${u.host}/`;
      } catch {
        console.warn(`Invalid URL skipped: ${line}`);
        return "";
      }
    })
    .filter(Boolean);
  // de-dup
  return Array.from(new Set(urls));
}

let csvStream: fs.WriteStream | null = null;
function initCsvLog(filePath: string) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "URL,Status\n", "utf8");
  }
  csvStream = fs.createWriteStream(filePath, { flags: "a" });
}

function logToCsv(_filePath: string, url: string, status: string) {
  if (!csvStream) return;
  const ok = csvStream.write(`"${url}","${status}"\n`);
  if (!ok) csvStream.once("drain", () => {});
}

function closeCsv() {
  csvStream?.end();
  csvStream = null;
}

// ---------------- Simple worker pool ----------------
type MsgOut = { id: number; url: string; status: string };

class WorkerPool {
  private size: number;
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: Array<{ id: number; url: string; contactData: ContactData }> = [];
  private nextId = 1;
  private resolveDrain?: () => void;
  private workerFile: string;
  private SPAWN_GAP_MS = 5;
  private WORKER_TIMEOUT_MS = 90_000; // playwright pages can be slow

  constructor(size: number) {
    this.size = size;
    this.workerFile = path.resolve(__dirname, "worker.js"); // after ts-node/transpile
  }

  private spawn(): Worker {
    const w = new Worker(this.workerFile);
    // Lifecycle
    w.on("message", (msg: MsgOut) => {
      logToCsv("", msg.url, msg.status);
      // Mark idle after each job (paired with .once('message') inside schedule)
    });
    w.on("error", (e) => {
      console.error("Worker error:", e?.message || e);
    });
    w.on("exit", (code) => {
      // Replace a dead worker to keep the pool healthy
      this.workers = this.workers.filter((x) => x !== w);
      this.idle = this.idle.filter((x) => x !== w);
      const nw = this.spawn();
      this.workers.push(nw);
      this.idle.push(nw);
      this.drain();
    });
    return w;
  }

  async start() {
    for (let i = 0; i < this.size; i++) {
      const w = this.spawn();
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  submit(url: string, contactData: ContactData) {
    const id = this.nextId++;
    this.queue.push({ id, url, contactData });
    this.drain();
  }

  private drain() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!;
      const job = this.queue.shift()!;

      // One result marks worker idle again
      const onJobDone = (msg: MsgOut) => {
        // put back to idle and continue
        this.idle.push(w);
        this.drain();
        // cleanup listener
        w.off("message", onJobDone as any);
      };

      // Add a watchdog in case the worker/job stalls
      const timer = setTimeout(() => {
        try {
          w.terminate();
        } catch {}
      }, this.WORKER_TIMEOUT_MS);

      w.once("message", (m: MsgOut) => {
        clearTimeout(timer);
        onJobDone(m);
      });

      w.postMessage(job);

      // Tiny stagger to smooth bursts
      if (this.SPAWN_GAP_MS) {
        const until = Date.now() + this.SPAWN_GAP_MS;
        while (Date.now() < until) {} // very short busy-wait to keep order; or setTimeout(this.drain, GAP)
      }
    }

    if (this.queue.length === 0 && this.idle.length === this.workers.length && this.resolveDrain) {
      this.resolveDrain();
      this.resolveDrain = undefined;
    }
  }

  async drainAll(): Promise<void> {
    if (this.queue.length === 0 && this.idle.length === this.workers.length) return;
    return new Promise<void>((resolve) => {
      this.resolveDrain = resolve;
    });
  }

  async stop() {
    const closes = this.workers.map((w) => w.terminate().catch(() => {}));
    await Promise.allSettled(closes);
  }
}

// ---------------- Main ----------------
async function processFile(fileName: string, maxWorkers = 6) {
  if (!fs.existsSync(fileName)) {
    console.log(`No file: ${fileName}, skipping.`);
    return;
  }

  const urls = prepareContactUrls(fileName);
  const logFile = fileName.replace(/(\.txt)?$/, "-results.csv");
  initCsvLog(logFile);
  console.log(`Processing ${urls.length} URLs from ${fileName} with ${maxWorkers} workers...`);

  const pool = new WorkerPool(maxWorkers);
  await pool.start();

  for (const u of urls) pool.submit(u, contactDataB);

  await pool.drainAll();
  await pool.stop();
  closeCsv();
  console.log("Done.");
}

// Run
(async () => {
  const fileName = "urls-auto-form.txt";
  await processFile(fileName, 24);
})();