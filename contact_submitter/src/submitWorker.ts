// import { mkdir, writeFile } from "node:fs/promises";
// import { dirname, join } from "node:path";
// import { fileURLToPath } from "node:url";
// import { Page } from "playwright";
// import { cfg } from "./config.js";
// import { ensureGroup, readBatch, ack, publishResult, XMessage } from "./queue.js";
// import { newContext } from "./browserPool.js";
// import { findFormCandidates } from "./detector.js";
// import { fillFields, mapFields } from "./mapper.js";
// import { waitForSuccess } from "./verifier.js";
// import pLimit, { LimitFunction } from "p-limit";
// import { customAlphabet } from "nanoid";

// const nano = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 12);
// const __dirname = dirname(fileURLToPath(import.meta.url));

// const domainLocks = new Map<string, LimitFunction>(); // 同一ドメイン直列化

// function log(msg: string) {
//   console.info(new Date().toISOString(), "[worker]", msg);
// }
// function logv(msg: string) {
//   if (cfg.verbose) log(msg);
// }

// function domainOf(url: string): string {
//   try {
//     return new URL(url).hostname;
//   } catch {
//     return "";
//   }
// }

// async function screenshotOnFail(page: Page, id: string) {
//   try {
//     const dir = cfg.screenshotDir;
//     await mkdir(dir, { recursive: true });
//     const path = join(dir, `${id}.jpg`);
//     await page.screenshot({ path, type: "jpeg", quality: 80, fullPage: false });
//     return path;
//   } catch {
//     return undefined;
//   }
// }

// type ProcStatus = "success" | "fail" | "error";

// async function processOne(msg: XMessage): Promise<ProcStatus> {
//   const { url, payload } = msg.job;
//   const domain = domainOf(url);
//   const id = nano();

//   log(`processing id=${id} url=${url}`);

//   const ctx = await newContext();
//   const page = await ctx.newPage();
//   page.setDefaultTimeout(cfg.navTimeoutMs);

//   let finalStatus: ProcStatus = "fail";

//   try {
//     log(`route setup (lightweight resources)`);
//     await page.route("**/*", (route) => {
//       const r = route.request();
//       const type = r.resourceType();
//       if (type === "image" || type === "font" || type === "media") {
//         return route.abort();
//       }
//       return route.continue();
//     });

//     log(`nav start url=${url}`);
//     await page.goto(url, { waitUntil: "networkidle", timeout: cfg.navTimeoutMs });
//     log(`nav done final_url=${page.url()}`);

//     // 候補フォーム抽出
//     log(`detect forms start`);
//     const candidates = await findFormCandidates(page);
//     log(`detect forms done candidates=${candidates.length}`);

//     if (!candidates.length) {
//       const shot = await screenshotOnFail(page, id);
//       await publishResult("res", {
//         id,
//         url,
//         domain,
//         status: "fail",
//         reason: "no_form_found",
//         screenshot: shot,
//       });
//       finalStatus = "fail";
//       return finalStatus;
//     }

//     let sent = false;
//     const tryList = candidates.slice(0, 3);
//     for (let i = 0; i < tryList.length; i++) {
//       const c = tryList[i];
//       log(`candidate#${i + 1} mapping fields`);
//       const root = c.root;
//       const map = await mapFields(root);

//       const hasEmail = !!map.email;
//       const hasMsg = !!map.message;
//       const hasSubmit = !!map.submit;
//       log(`candidate#${i + 1} mapped email=${hasEmail} message=${hasMsg} submit=${hasSubmit}`);

//       // 必須が足りない場合はスキップ
//       if (!hasEmail || !hasMsg || !hasSubmit) {
//         log(`candidate#${i + 1} skip (required fields missing)`);
//         continue;
//       }

//       log(`candidate#${i + 1} fill fields`);
//       await fillFields(map, payload);

//       log(`candidate#${i + 1} submit click`);
//       await map.submit!.click({ trial: false });

//       // 成功判定
//       log(`candidate#${i + 1} wait success signal`);
//       const verdict = await waitForSuccess(page);
//       log(`candidate#${i + 1} verdict=${verdict}`);

//       if (verdict !== "fail") {
//         await publishResult("res", {
//           id,
//           url,
//           domain,
//           status: "success",
//           verdict,
//         });
//         sent = true;
//         finalStatus = "success";
//         break;
//       }
//     }

//     if (!sent) {
//       log(`no candidate succeeded`);
//       const shot = await screenshotOnFail(page, id);
//       await publishResult("res", {
//         id,
//         url,
//         domain,
//         status: "fail",
//         reason: "no_success_signal",
//         screenshot: shot,
//       });
//       finalStatus = "fail";
//     }
//   } catch (e: any) {
//     log(`exception: ${String(e?.message ?? e)}`);
//     const shot = await screenshotOnFail(page, id);
//     await publishResult("res", {
//       id,
//       url,
//       domain,
//       status: "error",
//       error: String(e?.message ?? e),
//       screenshot: shot,
//     });
//     finalStatus = "error";
//   } finally {
//     await page.close().catch(() => {});
//     await ctx.close().catch(() => {});
//     log(`done id=${id} status=${finalStatus}`);
//   }

//   return finalStatus;
// }

// async function main() {
//   log("starting. headless=true");
//   if (cfg.verbose) log("verbose mode = ON");
//   await ensureGroup();
//   await mkdir(cfg.screenshotDir, { recursive: true });

//   while (true) {
//     const batch = await readBatch(cfg.concurrency);
//     log(`polled batch=${batch.length}`);

//     if (!batch.length) continue;

//     // ドメイン直列化 + 全体並列
//     const tasks = batch.map(async (m) => {
//       const key = domainOf(m.job.url);
//       if (!domainLocks.has(key)) {
//         domainLocks.set(key, pLimit(cfg.perDomainParallel));
//       }
//       const lock = domainLocks.get(key)!;

//       log(`enqueue domain=${key} id=${m.id}`);

//       const status = await lock(() => processOne(m));
//       log(`completed id=${m.id} status=${status}`);

//       await ack(m.id);
//       log(`ack id=${m.id}`);
//     });

//     await Promise.allSettled(tasks);
//   }
// }

// process.on("SIGINT", () => process.exit(0));
// process.on("SIGTERM", () => process.exit(0));

// main().catch((e) => {
//   console.error(new Date().toISOString(), "[worker]", "fatal:", e);
//   process.exit(1);
// });
