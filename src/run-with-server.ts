import { readFileSync, appendFileSync, existsSync, writeFileSync } from "fs";
import { Worker } from "worker_threads";
import path from "path";
import cron from "node-cron";
import { ContactData } from "./types";
import { env } from "process";

// -------------------------
// Helpers / small mappers
// -------------------------
function mapStatus(s: string): "success" | "failed" | "pending" | "running" {
  const x = (s || "").toLowerCase();
  if (x.includes("success") || x === "ok" || x === "done" || x === "200") return "success";
  if (x.includes("fail") || x.includes("error") || x === "ng") return "failed";
  return "failed";
}

function hostOf(u: string): string {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return h.startsWith("www.") ? h.slice(4) : h;
  } catch {
    return "";
  }
}

function originOfHost(host: string): string {
  return `https://${host}/`;
}

// -------------------------
// Local file (optional feed)
// -------------------------
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

// -------------------------
// API (Django)
// -------------------------
const BASE = (env.FORM_SERVER_BASE_URL || "").replace(/\/+$/, "");
const SECRET = env.FORM_SERVER_SECRET || "";

type TargetAPI = {
  id: number | string;
  host: string;
  created_at: string;
  profile?: { id: number | string; name?: string; data?: ContactData; version?: number; updated_at?: string } | null;
};

type Paginated<T> = { count: number; next: string | null; previous: string | null; results: T[] };

async function fetchUnsentTargets(limit = 200): Promise<TargetAPI[]> {
  if (!BASE || !SECRET) {
    console.warn("[fetchUnsentTargets] Missing FORM_SERVER_BASE_URL or FORM_SERVER_SECRET");
    return [];
  }
  const out: TargetAPI[] = [];
  let url = `${BASE}/export/unsent-targets/?page_size=50`;

  while (url && out.length < limit) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${SECRET}`, Accept: "application/json" },
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error(`[fetchUnsentTargets] HTTP ${res.status}: ${t}`);
      break;
    }
    const json = (await res.json()) as Paginated<TargetAPI> | TargetAPI[];
    const pageItems = Array.isArray(json) ? json : json.results || [];
    out.push(...pageItems);
    url = Array.isArray(json) ? "" : json.next || "";
  }
  return out.slice(0, limit);
}

async function logToDB(entry: {
  targetId?: number | string | null;
  profileId?: number | string | null;
  url: string;               // actual form URL used (or site root)
  host?: string;             // snapshot host
  status: "success" | "failed" | "pending" | "running";
  httpStatus?: number | null;
  payload?: any;             // what was sent
  responseBody?: string;
  responseJson?: any;
  errorMessage?: string;
}) {
  if (!BASE || !SECRET) {
    console.warn("[logToDB] Missing FORM_SERVER_BASE_URL or FORM_SERVER_SECRET");
    return;
  }

  const api = `${BASE}/export/submissions/`;

  const body = {
    // server will set user_name from its own actor (no identity sent here)
    target: entry.targetId ?? null,
    profile: entry.profileId ?? null,
    target_host_snapshot: entry.host ?? hostOf(entry.url),
    form_url: entry.url,
    payload: entry.payload ?? {},
    status: entry.status,
    http_status: entry.httpStatus ?? null,
    response_body: entry.responseBody ?? "",
    response_json: entry.responseJson ?? null,
    error_message: entry.errorMessage ?? "",
  };

  try {
    const res = await fetch(api, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SECRET}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[logToDB] HTTP ${res.status}: ${text}`);
      return;
    }

    const json = await res.json().catch(() => ({}));
    console.log("[logToDB] Saved submission id:", json?.id ?? "(unknown)");
  } catch (err) {
    console.error("[logToDB] Network error:", err);
  }
}

// -------------------------
// Parallel runner
// -------------------------
type WorkItem = {
  // Either a raw URL (from file) or a target+profile from API
  url: string; // candidate to start from (worker can discover contact page from here)
  targetId?: number | string | null;
  host?: string;
  profileId?: number | string | null;
  payload: ContactData;
};

function runInParallel(items: WorkItem[], logFile: string, maxWorkers = 8) {
  return new Promise<void>((resolve) => {
    let index = 0;
    let active = 0;
    const workerFile = path.resolve(__dirname, "worker.js");

    const runNext = () => {
      if (index >= items.length && active === 0) {
        resolve();
        return;
      }
      while (active < maxWorkers && index < items.length) {
        const item = items[index++];
        active++;
        const worker = new Worker(workerFile, {
          workerData: {
            // Let the worker try to detect actual contact page from this URL.
            // Provide host/profile/payload so it can submit:
            startUrl: item.url,
            host: item.host || hostOf(item.url),
            contactData: item.payload,
          },
        });

        // We expect worker to post: { url, status, httpStatus?, responseBody?, responseJson?, errorMessage? }
        worker.on("message", async (msg: any) => {
          const statusStr = mapStatus(String(msg?.status ?? ""));
          const finalUrl = String(msg?.url || item.url);
          const httpStatus = Number.isFinite(msg?.httpStatus) ? Number(msg.httpStatus) : null;

          console.log(`[worker] ${finalUrl} → ${statusStr}${httpStatus ? ` (${httpStatus})` : ""}`);
          logToCsv(logFile, finalUrl, statusStr);

          // Also log into Django
          await logToDB({
            targetId: item.targetId ?? null,
            profileId: item.profileId ?? null,
            url: finalUrl,
            host: item.host,
            status: statusStr,
            httpStatus,
            payload: item.payload,
            responseBody: msg?.responseBody ?? "",
            responseJson: msg?.responseJson ?? null,
            errorMessage: msg?.errorMessage ?? "",
          });
        });

        worker.on("error", (err) => {
          console.error(`[worker ERROR] ${item.url}:`, err);
          logToCsv(logFile, item.url, "worker error");
          // Also record as failed
          logToDB({
            targetId: item.targetId ?? null,
            profileId: item.profileId ?? null,
            url: item.url,
            host: item.host,
            status: "failed",
            httpStatus: null,
            payload: item.payload,
            errorMessage: String(err?.message || "worker error"),
          });
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

// -------------------------
// Main pipeline
// -------------------------
async function processToday() {
  const fileName = todayFileName();
  const logFile = fileName.replace("-auto-form.txt", "-results.csv");
  initCsvLog(logFile);

  // 1) Fetch unsent targets (with profile)
  const targets = await fetchUnsentTargets(1000);
  console.log(`[main] fetched ${targets.length} unsent targets`);

  // Convert targets to work items (start at site root; worker discovers contact page)
  const fromTargets: WorkItem[] = targets.map((t) => ({
    url: originOfHost(t.host),
    targetId: t.id,
    host: t.host,
    profileId: t.profile?.id ?? null,
    payload: (t.profile?.data as ContactData) ?? ({} as ContactData),
  }));

  // 2) Optionally merge today-file URLs (if present)
  let fromFile: WorkItem[] = [];
  if (existsSync(fileName)) {
    const urls = prepareContactUrls(fileName);
    console.log(`[main] loaded ${urls.length} URLs from ${fileName}`);
    fromFile = urls.map((u) => ({
      url: u,
      targetId: null,
      host: hostOf(u),
      profileId: null,
      // Fallback payload if your worker needs it (no profile attached)
      payload: {} as ContactData,
    }));
  } else {
    console.log(`[main] No file for today: ${fileName} (this is OK)`);
  }

  const items: WorkItem[] = [...fromTargets, ...fromFile];
  console.log(`[main] total items to process: ${items.length}`);

  if (items.length === 0) return;

  // 3) Run workers
  await runInParallel(items, logFile, Number(env.FORM_MAX_WORKERS || 16));
}

// -------------------------
// Schedule (daily at 00:00)
// -------------------------
cron.schedule("0 0 * * *", () => {
  console.log("=== Daily job started ===");
  processToday().catch((e) => console.error("[main] fatal:", e));
});