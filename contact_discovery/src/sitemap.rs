use anyhow::{anyhow, Context, Result};
use quick_xml::events::Event;
use quick_xml::Reader;
use reqwest::Client;
use std::time::Duration;
use url::Url;

#[derive(Debug, Clone)]
pub struct SitemapEntries {
    pub urls: Vec<Url>,
}

pub async fn discover_sitemaps(client: &Client, root: &Url) -> Result<Vec<Url>> {
    // 1) robots.txt から Sitemap エントリを拾う
    let mut sitemaps = vec![];
    if let Ok(mut from_robots) = sitemaps_from_robots(client, root).await {
        sitemaps.append(&mut from_robots);
    }
    // 2) フォールバック /sitemap.xml
    if sitemaps.is_empty() {
        if let Ok(u) = root.join("/sitemap.xml") {
            sitemaps.push(u);
        }
    }
    // 重複除去
    sitemaps.sort();
    sitemaps.dedup();
    Ok(sitemaps)
}

async fn sitemaps_from_robots(client: &Client, root: &Url) -> Result<Vec<Url>> {
    let robots_url = root.join("/robots.txt")?;
    let res = client
        .get(robots_url.clone())
        .timeout(Duration::from_secs(10))
        .send()
        .await?;

    if !res.status().is_success() {
        return Ok(vec![]); // robots なしでもOK
    }
    let text = res.text().await.unwrap_or_default();

    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        // 大文字小文字ゆるめに判定
        if let Some(rest) = line.strip_prefix("Sitemap:").or_else(|| line.strip_prefix("sitemap:")) {
            let loc = rest.trim();
            if let Ok(u) = Url::parse(loc) {
                out.push(u);
            } else if let Ok(u) = root.join(loc) {
                out.push(u);
            }
        }
    }
    Ok(out)
}

/// sitemap / sitemapindex のどちらでも受け取り、全URLを列挙
pub async fn fetch_and_parse_sitemap(client: &Client, sitemap_url: &Url, max_urls: usize) -> Result<SitemapEntries> {
    let res = client
        .get(sitemap_url.clone())
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .with_context(|| format!("fetch sitemap {}", sitemap_url))?;

    if !res.status().is_success() {
        return Err(anyhow!("sitemap http {}", res.status()));
    }
    let bytes = res.bytes().await?;
    parse_sitemap_xml(&bytes, sitemap_url, max_urls)
}

fn parse_sitemap_xml(data: &[u8], base: &Url, max_urls: usize) -> Result<SitemapEntries> {
    // sitemapindex と urlset の両方に対応、stream parser で軽量に
    let mut reader = Reader::from_reader(data);
    reader.trim_text(true);

    let mut buf = Vec::new();
    let mut in_loc = false;
    let mut urls = Vec::new();
    let mut is_index = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = e.name().as_ref().to_ascii_lowercase();
                if name.ends_with(b"index") {
                    is_index = true;
                }
                if name.ends_with(b"loc") {
                    in_loc = true;
                }
            }
            Ok(Event::Text(t)) => {
                if in_loc {
                    let loc_raw = t.unescape().unwrap_or_default().to_string();
                    if let Ok(u) = Url::parse(&loc_raw).or_else(|_| base.join(&loc_raw)) {
                        urls.push(u);
                        if urls.len() >= max_urls {
                            break;
                        }
                    }
                }
            }
            Ok(Event::End(e)) => {
                let name = e.name().as_ref().to_ascii_lowercase();
                if name.ends_with(b"loc") {
                    in_loc = false;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(anyhow!("xml parse error: {}", e)),
            _ => {}
        }
        if urls.len() >= max_urls {
            break;
        }
    }

    // sitemapindex だった場合は、上位のsitemapたちをさらに呼ぶのは呼び出し側で
    Ok(SitemapEntries { urls })
}
