export interface DiscoverReq {
    root_url: string,
    top_n: number
}

export type DiscoverResult = {
  url: string,
  score: number,
  positives: string[],
  negatives: string[],
  status: number,
  content_type: string,
  size: number
}

export type DiscoverRes = {
  root_url: string,
  tried: number,
  fetched: number,
  results_top: DiscoverResult[],
  error?: string;
}

export async function discover_request(url: string): Promise<DiscoverResult[]> {
	const discover_req: DiscoverReq = {
		root_url: url,
		top_n: 5,
	};

	try {
		const discover_res = await fetch("http://localhost:8080/discover", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(discover_req),
		});

		if (!discover_res.ok) {
			return [];
		}

		const discover_results: DiscoverRes = await discover_res.json();

		return discover_results.results_top;
	} catch {
		return [];
	}
}
