mod fetch;
mod scoring;
mod handlers;
mod app_state;

use axum::{
    routing::{get, post},
    Router,
};
use std::{net::SocketAddr, sync::Arc};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing_subscriber::{fmt, EnvFilter};

use fetch::make_browserish_client;

use crate::app_state::AppState;
use crate::handlers::scoring::score_url;


#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // logging
    fmt()
        .with_env_filter(EnvFilter::from_default_env()
            .add_directive("contact_scoring_api=info".parse()?)
            .add_directive("axum=info".parse()?))
        .init();

    let http = make_browserish_client()?;
    let state = Arc::new(AppState { http });

    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/score", post(score_url))
        .with_state(state)
        .layer(
            CorsLayer::permissive() // 必要に応じて厳格化
        )
        .layer(TraceLayer::new_for_http());

    let addr: SocketAddr = "0.0.0.0:8080".parse()?;
    tracing::info!("listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await.unwrap();
    axum::serve(listener, app).await.unwrap();
    Ok(())
}

async fn healthz() -> &'static str {
    "ok"
}
