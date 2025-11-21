export interface Pagination<T> {
    count: number,
    next: string,
    previous: string,
    results: T[]
}

export interface Profile {
    id: number,
    name: string,
    data: Record<string, string>
}


export interface UnsentTarget {
    id: number,
    host: string,
    created_at: string,
    profile: Profile,
    tracking_id: string
}


export type UnsentTargetResults = Pagination<UnsentTarget>;

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
  results_top: DiscoverResult[]
}
