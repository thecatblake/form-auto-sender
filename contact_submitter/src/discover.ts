export type DiscoverReq = {
  root_url: string;
  fetch_limit: number;
  top_n: number;
  concurrency: number;
  sitemap_url_limit: number;
};

export type DiscoverItem = {
  url: string;
  score: number;
  positives?: string[];
  negatives?: string[];
  status?: number;
  content_type?: string | null;
  size?: number;
};

export type DiscoverResp = {
  results_top?: DiscoverItem[];
  [k: string]: any;
};

// discover.ts
export async function discoverContacts(
  endpoint: string,
  root_url: string,
  fetch_limit: number,
  top_n: number,
  concurrency: number,
  sitemap_url_limit: number,
  timeoutMs: number
): Promise<DiscoverItem[]> {
  const payload: DiscoverReq = {
    root_url,
    fetch_limit,
    top_n,
    concurrency,
    sitemap_url_limit,
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(0, timeoutMs));

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`discoverContacts: HTTP ${res.status} ${res.statusText} ${text ? `- ${text.slice(0,200)}` : ""}`);
    }

    const data = (await res.json()) as DiscoverResp;
    return data.results_top ?? [];
  } finally {
    clearTimeout(timer);
  }
}
