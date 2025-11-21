use std::{sync::Arc, time::Instant};

use axum::{Json, extract::State};
use contact_discovery::heuristics::known_contact_paths;
use futures::stream::{FuturesUnordered, StreamExt};
use url::Url;
use serde::{Serialize, Deserialize};
use tokio::sync::Semaphore as HostSem;
use tracing::{debug, info, warn, instrument};
use crate::{
	app_state::AppState, fetch::fetch, heuristics::{candidates_from_root_html, heuristic_url_priority}, scoring::score_contact_form_like, sitemap::{discover_sitemaps, fetch_and_parse_sitemap}
};

#[derive(Deserialize)]
pub struct DiscoverReq {
    root_url: String,
    // オプション
    #[serde(default = "d_heur_limit")]
    sitemap_url_limit: usize,   // sitemapから拾うURL数の上限（優先度降順で使用）
    #[serde(default = "d_fetch_limit")]
    fetch_limit: usize,         // 実際にfetchするページ数上限
    #[serde(default = "d_topn")]
    top_n: usize,               // スコア上位N件を返す
    #[serde(default = "d_concurrency")]
    concurrency: usize,         // 同期実行数（全体）
}
fn d_heur_limit() -> usize { 2000 }
fn d_fetch_limit() -> usize { 60 }
fn d_topn() -> usize { 5 }
fn d_concurrency() -> usize { 16 }

#[derive(Serialize)]
pub struct DiscoverItem {
    url: String,
    score: i32,
    positives: Vec<String>,
    negatives: Vec<String>,
    status: i32,
    content_type: Option<String>,
    size: i64,
}

#[derive(Serialize)]
pub struct DiscoverResp {
    root_url: String,
    tried: usize,
    fetched: usize,
    results_top: Vec<DiscoverItem>,
    note: Option<String>,
}


#[instrument(name = "discover_from_sitemap", skip(state, req), fields(root_url = %req.root_url))]
pub async fn discover_from_sitemap(
    State(state): State<Arc<AppState>>,
    Json(req): Json<DiscoverReq>,
) -> Json<DiscoverResp> {
    let t0 = Instant::now();

    debug!(
        sitemap_url_limit = req.sitemap_url_limit,
        fetch_limit = req.fetch_limit,
        top_n = req.top_n,
        concurrency = req.concurrency,
        "request params"
    );

    let root = match Url::parse(&req.root_url) {
        Ok(u) => {
            info!(%u, "parsed root_url");
            u
        }
        Err(e) => {
            warn!(error = %e, "invalid root_url");
            return Json(DiscoverResp {
                root_url: req.root_url,
                tried: 0,
                fetched: 0,
                results_top: vec![],
                note: Some(format!("invalid root_url: {e}")),
            });
        }
    };

    let smaps_res = discover_sitemaps(&state.http, &root).await;
    let smaps = match smaps_res {
        Ok(v) if !v.is_empty() => {
            info!(count = v.len(), "sitemaps discovered");
            v
        }
        _ => {
            warn!("no sitemap discovered");
            return Json(DiscoverResp {
                root_url: req.root_url,
                tried: 0,
                fetched: 0,
                results_top: vec![],
                note: Some("no sitemap discovered".into()),
            });
        }
    };

	let mut pool: Vec<(Url, i32, &'static str)> = Vec::new();

	{
        let mut knowns = known_contact_paths(&root);
        info!(count = knowns.len(), "known paths prepared");
        pool.append(&mut knowns);
    }

	if !smaps.is_empty() {
        let mut all_urls: Vec<Url> = vec![];
        for (i, sm) in smaps.iter().take(5).enumerate() {
            let ti = Instant::now();
            match fetch_and_parse_sitemap(&state.http, sm, req.sitemap_url_limit).await {
                Ok(entries) => {
                    let n = entries.urls.len();
                    info!(idx = i, sitemap = %sm, urls = n, elapsed_ms = ti.elapsed().as_millis() as u64, "parsed sitemap");
                    all_urls.extend(entries.urls);
                }
                Err(e) => warn!(idx = i, sitemap = %sm, error = %e, "failed to parse sitemap"),
            }
        }
        for u in all_urls {
            let p = heuristic_url_priority(&u);
            if p > 0 {
                pool.push((u, p, "sitemap"));
            }
        }
    }

    {
        match fetch(root.as_str(), state.http.clone()).await {
            Ok(fr) => {
                let is_html = fr.content_type.as_deref().map(|ct| {
                    let lc = ct.to_lowercase();
                    lc.starts_with("text/html") || lc.contains("application/xhtml+xml")
                }).unwrap_or(false);
                if is_html {
                    let html = String::from_utf8_lossy(&fr.body).to_string();
                    let mut from_root = candidates_from_root_html(&root, &html);
                    info!(count = from_root.len(), "root anchors collected");
                    pool.append(&mut from_root);
                } else {
                    debug!("root is not HTML; skip root anchors");
                }
            }
            Err(e) => warn!(error = %e, "fetch root failed; skip root anchors"),
        }
    }

    if pool.is_empty() {
        warn!("no candidates from sitemap/known/root");
        return Json(DiscoverResp {
            root_url: req.root_url,
            tried: 0,
            fetched: 0,
            results_top: vec![],
            note: Some("no candidate URLs found".into()),
        });
    }

    // 同一URLは最高スコアを採用
    use std::collections::HashMap;
    let mut map: HashMap<String, (Url, i32, &'static str)> = HashMap::new();
    for (u, p, src) in pool {
        let key = u.as_str().to_string();
        match map.get(&key) {
            Some((_, old_p, _)) if *old_p >= p => {}
            _ => { map.insert(key, (u, p, src)); }
        }
    }

    let mut uniq: Vec<(Url, i32, &'static str)> = map.into_values().collect();
    uniq.sort_by_key(|(_, p, _)| std::cmp::Reverse(*p));

    info!(candidates = uniq.len(), top_score = uniq.first().map(|(_,p,_)| *p), "merged candidate pool");

    let limit = req.fetch_limit.min(state.max_fetch_per_site);
    let targets: Vec<(Url, i32, &'static str)> = uniq.into_iter().take(limit).collect();
    info!(targets = targets.len(), "selected targets to fetch");

    let sem = Arc::new(tokio::sync::Semaphore::new(req.concurrency));
    let mut host_sems: HashMap<String, Arc<HostSem>> = HashMap::new();

    let mut futs = FuturesUnordered::new();
    for (u, pri, src) in targets {
        let http = state.http.clone();
        let host = u.host_str().unwrap_or_default().to_string();
        let host_sem = host_sems.entry(host.clone())
            .or_insert_with(|| Arc::new(HostSem::new(state.per_host_concurrency)))
            .clone();
        let sem_for_task = sem.clone();

        futs.push(async move {
            let span = tracing::info_span!("fetch_score", url = %u, host = %host, priority = pri, source = %src);
            let _enter = span.enter();

            let _global_g = match sem_for_task.acquire_owned().await {
                Ok(g) => g, Err(e) => { tracing::error!(%e, "global semaphore"); return None; }
            };
            let _host_g = match host_sem.acquire_owned().await {
                Ok(g) => g, Err(e) => { tracing::error!(%e, "host semaphore"); return None; }
            };

            let t_fetch = Instant::now();
            match fetch(u.as_str(), http).await {
                Ok(fr) => {
                    let fetch_ms = t_fetch.elapsed().as_millis() as u64;
                    tracing::debug!(status = fr.status, size = fr.size, ct = ?fr.content_type, elapsed_ms = fetch_ms, "fetched");

                    let is_html = fr.content_type.as_deref().map(|ct| {
                        let lc = ct.to_lowercase();
                        lc.starts_with("text/html") || lc.contains("application/xhtml+xml")
                    }).unwrap_or(false);

                    if !is_html {
                        tracing::debug!("skipped: non-html");
                        return None;
                    }

                    let html = String::from_utf8_lossy(&fr.body).to_string();
                    let t_score = Instant::now();
                    let s = score_contact_form_like(&html);
                    let score_ms = t_score.elapsed().as_millis() as u64;
                    tracing::info!(score = s.score, fetch_ms, score_ms, "scored");

                    Some(DiscoverItem {
                        url: u.to_string(),
                        score: s.score,
                        positives: s.positives,
                        negatives: s.negatives,
                        status: fr.status,
                        content_type: fr.content_type,
                        size: fr.size,
                    })
                }
                Err(e) => { tracing::warn!(%e, "fetch error"); None }
            }
        });
    }

    let mut results: Vec<DiscoverItem> = vec![];
    let mut fetched = 0usize;
    while let Some(o) = futs.next().await {
        fetched += 1;
        if let Some(item) = o { results.push(item); }
        if fetched % 10 == 0 { debug!(fetched, kept = results.len(), "progress"); }
    }

    results.sort_by_key(|r| std::cmp::Reverse(r.score));
    let top = results.into_iter().take(req.top_n).collect::<Vec<_>>();
    let elapsed_ms = t0.elapsed().as_millis() as u64;
    info!(elapsed_ms, tried = limit, returned = top.len(), "discover_from_sitemap done");

    Json(DiscoverResp {
        root_url: root.to_string(),
        tried: limit,
        fetched,
        results_top: top,
        note: None,
    })
}