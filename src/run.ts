import { readFileSync, appendFileSync, existsSync, writeFileSync } from "fs";
import { URL } from "url";
import { Worker } from "worker_threads";
import path from "path";
import cron from "node-cron";
import { ContactData } from "./types";

// ---- データ雛形 ----
const contactData: ContactData = {
  sei: "山田",
  mei: "太郎",
  furigana_sei: "ヤマダ",
  furigana_mei: "タロウ",
  manager: "山本 太郎",
  name: "山本 太郎",
  furigana: "やまもと たろう",
  kana: "ヤマモト タロウ",
  email: "taro.yamada@example.com",
  phone: "0312345678",
  subject: "ホームページを拝見いたしました。",
  message:
    "貴社のサービスについて、詳細をお伺いしたくご連絡いたしました。何卒よろしくお願い申し上げます。",
  company: "株式会社サンプル",
  department: "営業部",
  prefecture: "東京都",
  post_code: "3320125",
  address: "千代田区丸の内１丁目９−２",
};

// ---- ユーティリティ ----
function todayFileName(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}-auto-form.txt`;
}

function prepareContactUrls(filePath: string): string[] {
  const raw = readFileSync(filePath, "utf8").trim().split(/\r?\n/);
  return raw
    .map((line) => {
      try {
        const u = new URL(line);
        return `${u.protocol}//${u.host}/`;
      } catch {
        console.warn(`Invalid URL skipped: ${line}`);
        return "";
      }
    })
    .filter(Boolean);
}

function initCsvLog(filePath: string) {
  if (!existsSync(filePath)) {
    writeFileSync(filePath, "URL,Status\n", "utf8");
  }
}

function logToCsv(filePath: string, url: string, status: string) {
  appendFileSync(filePath, `"${url}","${status}"\n`, "utf8");
}

function runInParallel(urls: string[], logFile: string, maxWorkers = 4) {
  return new Promise<void>((resolve) => {
    let index = 0;
    let active = 0;
    const workerFile = path.resolve(__dirname, "worker.js");

    const runNext = () => {
      if (index >= urls.length && active === 0) {
        resolve();
        return;
      }
      while (active < maxWorkers && index < urls.length) {
        const url = urls[index++];
        active++;
        const worker = new Worker(workerFile, {
          workerData: { url, contactData },
        });
        worker.on("message", (msg: { url: string; status: string }) => {
          console.log(`[${msg.url}] → ${msg.status}`);
          logToCsv(logFile, msg.url, msg.status);
        });
        worker.on("error", (err) => {
          console.error(`[${url}] ERROR:`, err);
          logToCsv(logFile, url, "worker error");
        });
        worker.on("exit", () => {
          active--;
          runNext();
        });
      }
    };
    runNext();
  });
}

// ---- メイン処理 ----
async function processTodayFile() {
  const fileName = todayFileName();
  if (!existsSync(fileName)) {
    console.log(`No file for today: ${fileName}, skipping.`);
    return;
  }

  const urls = prepareContactUrls(fileName);
  const logFile = fileName.replace("-auto-form.txt", "-results.csv");

  initCsvLog(logFile);
  console.log(`Processing ${urls.length} URLs from ${fileName}...`);
  await runInParallel(urls, logFile, 24);
}

// ---- node-cron スケジューラー ----
// "0 0 * * *" = 毎日0時に実行
cron.schedule("0 0 * * *", () => {
  console.log("=== Daily job started ===");
  processTodayFile();
});
