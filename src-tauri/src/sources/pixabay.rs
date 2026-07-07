//! Pixabay provider (<https://pixabay.com/api/>). Requires a free API key —
//! there is no keyless mode. Content is SFW (safesearch on); the license is
//! permissive (no attribution required), but we still record the uploader.

use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::sources::{SourceFilters, SourceItem, SourceProvider, SourceSearchResult};

const SEARCH_URL: &str = "https://pixabay.com/api/";
/// Pixabay caps `per_page` at 200 and total accessible results at 500 (free).
const PER_PAGE: u32 = 100;

#[derive(Debug, Deserialize)]
struct PxResponse {
    /// Accessible hit count (already capped by Pixabay), drives pagination.
    #[serde(rename = "totalHits")]
    total_hits: u32,
    hits: Vec<PxHit>,
}

#[derive(Debug, Deserialize)]
struct PxHit {
    id: u64,
    #[serde(rename = "pageURL")]
    page_url: String,
    /// ~640px preview shown in the grid.
    #[serde(rename = "webformatURL")]
    webformat_url: String,
    /// ~1280px, downloaded on import (the original needs full API access).
    #[serde(rename = "largeImageURL")]
    large_image_url: String,
    #[serde(rename = "imageWidth")]
    image_width: u32,
    #[serde(rename = "imageHeight")]
    image_height: u32,
    #[serde(default)]
    user: String,
}

fn ext_from_url(url: &str) -> String {
    url.rsplit('/')
        .next()
        .and_then(|name| name.rsplit('.').next())
        .map(|ext| ext.split(['?', '#']).next().unwrap_or(ext))
        .filter(|ext| ext.len() <= 5 && ext.chars().all(|c| c.is_ascii_alphanumeric()))
        .map(|ext| ext.to_ascii_lowercase())
        .unwrap_or_else(|| "jpg".to_string())
}

fn map_hit(hit: PxHit) -> SourceItem {
    SourceItem {
        provider: SourceProvider::Pixabay,
        id: hit.id.to_string(),
        thumb_url: hit.webformat_url,
        ext: ext_from_url(&hit.large_image_url),
        full_url: hit.large_image_url,
        source_page_url: hit.page_url,
        width: hit.image_width,
        height: hit.image_height,
        author: if hit.user.is_empty() {
            None
        } else {
            Some(hit.user)
        },
        license: Some("Pixabay Content License".to_string()),
        attribution: None,
    }
}

/// Map the shared `sorting` filter to Pixabay's `order` (only two options).
fn order_param(filters: &SourceFilters) -> &'static str {
    match filters.sorting.as_deref() {
        Some("latest") => "latest",
        _ => "popular",
    }
}

fn parse_response(body: &str, page: u32) -> AppResult<SourceSearchResult> {
    let resp: PxResponse = serde_json::from_str(body)
        .map_err(|err| AppError::Network(format!("pixabay: unexpected response: {err}")))?;
    let last_page = resp.total_hits.div_ceil(PER_PAGE).max(1);
    Ok(SourceSearchResult {
        items: resp.hits.into_iter().map(map_hit).collect(),
        page,
        last_page,
    })
}

pub async fn search(
    client: &reqwest::Client,
    query: &str,
    page: u32,
    filters: &SourceFilters,
    api_key: Option<&str>,
) -> AppResult<SourceSearchResult> {
    let key = api_key.filter(|k| !k.is_empty()).ok_or_else(|| {
        AppError::Conflict("Pixabay requires an API key (set it in Preferences)".into())
    })?;
    let page = page.max(1);
    let mut params = vec![
        ("key", key.to_string()),
        ("q", query.to_string()),
        ("page", page.to_string()),
        ("per_page", PER_PAGE.to_string()),
        ("safesearch", "true".to_string()),
        ("order", order_param(filters).to_string()),
    ];
    if let Some(image_type) = &filters.image_type {
        params.push(("image_type", image_type.clone()));
    }
    if let Some(orientation) = &filters.orientation {
        params.push(("orientation", orientation.clone()));
    }
    let body = client
        .get(SEARCH_URL)
        .query(&params)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    parse_response(&body, page)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"{
      "total": 5000,
      "totalHits": 500,
      "hits": [
        {
          "id": 195893,
          "pageURL": "https://pixabay.com/photos/blossom-bloom-flower-195893/",
          "type": "photo",
          "tags": "blossom, bloom, flower",
          "previewURL": "https://cdn.pixabay.com/photo/2013/10/15/09/12/flower-195893_150.jpg",
          "webformatURL": "https://pixabay.com/get/g abc_640.jpg",
          "webformatWidth": 640,
          "webformatHeight": 426,
          "largeImageURL": "https://pixabay.com/get/g def_1280.jpg",
          "imageWidth": 4000,
          "imageHeight": 2662,
          "user": "Josch13"
        }
      ]
    }"#;

    #[test]
    fn parses_hits_and_pagination() {
        let result = parse_response(FIXTURE, 1).expect("parse");
        assert_eq!(result.page, 1);
        // 500 hits / 100 per page = 5 pages.
        assert_eq!(result.last_page, 5);
        assert_eq!(result.items.len(), 1);
        let item = &result.items[0];
        assert_eq!(item.provider, SourceProvider::Pixabay);
        assert_eq!(item.id, "195893");
        assert_eq!(item.thumb_url, "https://pixabay.com/get/g abc_640.jpg");
        assert_eq!(item.full_url, "https://pixabay.com/get/g def_1280.jpg");
        assert_eq!(
            item.source_page_url,
            "https://pixabay.com/photos/blossom-bloom-flower-195893/"
        );
        assert_eq!((item.width, item.height), (4000, 2662));
        assert_eq!(item.ext, "jpg");
        assert_eq!(item.author.as_deref(), Some("Josch13"));
        assert_eq!(item.license.as_deref(), Some("Pixabay Content License"));
    }

    #[test]
    fn ext_parsing_handles_query_strings_and_fallback() {
        assert_eq!(ext_from_url("https://x/y_1280.png"), "png");
        assert_eq!(ext_from_url("https://x/y_1280.jpg?token=abc"), "jpg");
        assert_eq!(ext_from_url("https://x/no-extension"), "jpg");
    }

    #[test]
    fn order_defaults_to_popular() {
        let popular = SourceFilters::default();
        assert_eq!(order_param(&popular), "popular");
        let latest = SourceFilters {
            sorting: Some("latest".into()),
            ..Default::default()
        };
        assert_eq!(order_param(&latest), "latest");
    }
}
