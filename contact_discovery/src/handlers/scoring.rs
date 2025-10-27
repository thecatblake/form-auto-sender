use std::sync::Arc;

use axum::{Json, extract::State};
use serde::{Deserialize, Serialize};

use crate::app_state::AppState;
use crate::fetch::fetch;
use crate::scoring::score_contact_form_like;

#[derive(Deserialize)]
pub struct ScoreUrlReq {
    url: String,
}

#[derive(Serialize)]
pub struct ScoreUrlResp {
    url: String,
    status: i32,
    domain: Option<String>,
    content_type: Option<String>,
    size: i64,
    is_html: bool,
    score: Option<i32>,
    positives: Option<Vec<String>>,
    negatives: Option<Vec<String>>,
    note: Option<String>,
}

pub async fn score_url(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ScoreUrlReq>,
) -> Json<ScoreUrlResp> {
    let client = state.http.clone();
    let result = fetch(&req.url, client).await;

    match result {
        Ok(res) => {
            let is_html = res
                .content_type
                .as_deref()
                .map(|ct| ct.to_lowercase().starts_with("text/html") || ct.to_lowercase().contains("application/xhtml+xml"))
                .unwrap_or(false);

            if !is_html {
                return Json(ScoreUrlResp {
                    url: req.url,
                    status: res.status,
                    domain: res.domain,
                    content_type: res.content_type,
                    size: res.size,
                    is_html,
                    score: None,
                    positives: None,
                    negatives: None,
                    note: Some("content-typeがHTMLではありません".into()),
                });
            }

            // 文字列化（reqwestは自動デコードするが、明示的にUTF-8として解釈: 不正バイトは置換）
            let html = String::from_utf8_lossy(&res.body).to_string();
            let scored = score_contact_form_like(&html);

            Json(ScoreUrlResp {
                url: req.url,
                status: res.status,
                domain: res.domain,
                content_type: res.content_type,
                size: res.size,
                is_html: true,
                score: Some(scored.score),
                positives: Some(scored.positives),
                negatives: Some(scored.negatives),
                note: None,
            })
        }
        Err(e) => Json(ScoreUrlResp {
            url: req.url,
            status: 0,
            domain: None,
            content_type: None,
            size: 0,
            is_html: false,
            score: None,
            positives: None,
            negatives: None,
            note: Some(format!("fetch error: {e:?}")),
        }),
    }
}
