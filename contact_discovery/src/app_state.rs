use reqwest::Client;

#[derive(Clone)]
pub struct AppState {
    pub http: Client,
	pub per_host_concurrency: usize,
    pub max_fetch_per_site: usize,
}
