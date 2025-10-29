import Redis from "ioredis";
import { cfg } from "./config.js";

export type SubmitJob = {
  url: string;
  payload: {
    name: string;
    email: string;
    message: string;
    company?: string;
    phone?: string;
    subject?: string;
  };
};

export const redis = new Redis(cfg.redisUrl, { lazyConnect: false });

// コンシューマグループ作成（初回）
export async function ensureGroup() {
  try {
    await redis.xgroup("CREATE", cfg.stream, cfg.group, "0", "MKSTREAM");
  } catch (e: any) {
    if (!String(e?.message ?? e).includes("BUSYGROUP")) throw e;
  }
}

export type XMessage = { id: string; job: SubmitJob };

type XReadGroupResponse = Array<[
  stream: string,
  entries: Array<[id: string, fields: string[]]>
]>;

export async function readBatch(max: number): Promise<XMessage[]> {
  const resp = await redis.xreadgroup(
    "GROUP",
    cfg.group,
    cfg.consumer,
    "COUNT",
    max,
    "BLOCK",
    5000,
    "STREAMS",
    cfg.stream,
    ">"
  )　as XReadGroupResponse;;
  const out: XMessage[] = [];
  if (!resp) return out;
  for (const [, entries] of resp) {
    for (const [id, fields] of entries) {
      const obj: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        obj[fields[i]] = fields[i + 1];
      }
      try {
        const job = JSON.parse(obj.job ?? "{}");
        out.push({ id, job });
      } catch {
        // 破損メッセージはACKして捨てる
        await redis.xack(cfg.stream, cfg.group, id);
      }
    }
  }
  return out;
}

export async function ack(id: string) {
  await redis.xack(cfg.stream, cfg.group, id);
}

export async function publishResult(key: string, value: any) {
  // 結果は JSON で別ストリームに
  await redis.xadd(`${cfg.stream}:results`, "*", "result", JSON.stringify(value));
}
