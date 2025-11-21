use std::time::Duration;

use reqwest::{header::{HeaderMap, HeaderValue, ACCEPT, ACCEPT_ENCODING, ACCEPT_LANGUAGE, USER_AGENT}, redirect, Client, IntoUrl};
use bytes::Bytes;
use anyhow::Result;

pub struct FetchResult {
    pub status: i32,
    pub content_type: Option<String>,
    pub body: Bytes,
    pub size: i64,
	pub domain: Option<String>
}

pub async fn fetch<U>(url: U, client: Client) -> Result<FetchResult>
where
    U: IntoUrl,
{
    let res = client.get(url).send().await?;

    let status = res.status().as_u16() as i32;
    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let final_url = res.url().clone();
    let domain = final_url
        .host_str()
        .map(|s| s.to_string());

    let body = res.bytes().await?;
    let size = body.len() as i64;

    Ok(FetchResult {
        status,
        content_type,
        body,
        size,
        domain,
    })
}

fn chrome_like_headers() -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert(USER_AGENT, HeaderValue::from_static(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
         AppleWebKit/537.36 (KHTML, like Gecko) \
         Chrome/124.0.0.0 Safari/537.36"
    ));
    h.insert(ACCEPT, HeaderValue::from_static(
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    ));
    h.insert(ACCEPT_LANGUAGE, HeaderValue::from_static("ja,en;q=0.9"));
    h.insert(ACCEPT_ENCODING, HeaderValue::from_static("gzip, deflate, br"));

    h.insert("Cache-Control", HeaderValue::from_static("no-cache"));
    h.insert("Pragma", HeaderValue::from_static("no-cache"));
    h.insert("Upgrade-Insecure-Requests", HeaderValue::from_static("1"));
    h.insert("Sec-Fetch-Dest", HeaderValue::from_static("document"));
    h.insert("Sec-Fetch-Mode", HeaderValue::from_static("navigate"));
    h.insert("Sec-Fetch-Site", HeaderValue::from_static("none"));
    h.insert("Sec-Fetch-User", HeaderValue::from_static("?1"));
    h
}

pub fn make_browserish_client() -> Result<Client> {
    Ok(Client::builder()
        .cookie_store(true)                         
        .default_headers(chrome_like_headers())     
        .redirect(redirect::Policy::limited(10))    
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .tcp_keepalive(Duration::from_secs(30))
        .build()?)
}
