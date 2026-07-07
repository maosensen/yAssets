//! Wallhaven provider (<https://wallhaven.cc/api/v1>). SFW browsing needs no
//! key; an optional user API key unlocks sketchy/NSFW purity + higher rate
//! limits (~45 req/min). We enforce SFW server-side whenever no key is set.

use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::sources::{SourceFilters, SourceItem, SourceProvider, SourceSearchResult};

const SEARCH_URL: &str = "https://wallhaven.cc/api/v1/search";

// --- Wallhaven JSON response (only the fields we consume) ---

#[derive(Debug, Deserialize)]
struct WhResponse {
    data: Vec<WhItem>,
    meta: WhMeta,
}

#[derive(Debug, Deserialize)]
struct WhItem {
    id: String,
    /// The item's page on wallhaven.cc — stored as provenance.
    url: String,
    /// Full-resolution image URL.
    path: String,
    file_type: String,
    dimension_x: u32,
    dimension_y: u32,
    thumbs: WhThumbs,
}

#[derive(Debug, Deserialize)]
struct WhThumbs {
    large: String,
}

#[derive(Debug, Deserialize)]
struct WhMeta {
    current_page: u32,
    last_page: u32,
}

fn ext_from_file_type(file_type: &str) -> &'static str {
    match file_type {
        "image/png" => "png",
        "image/gif" => "gif",
        _ => "jpg",
    }
}

/// Build the query string. Without an API key, purity is forced to SFW ("100")
/// regardless of what the caller asked for.
fn build_query(
    query: &str,
    page: u32,
    filters: &SourceFilters,
    api_key: Option<&str>,
) -> Vec<(String, String)> {
    let has_key = api_key.map(|k| !k.is_empty()).unwrap_or(false);
    let purity = if has_key {
        filters.purity.clone().unwrap_or_else(|| "100".into())
    } else {
        "100".into()
    };

    let mut params = vec![
        ("q".to_string(), query.to_string()),
        ("page".to_string(), page.max(1).to_string()),
        ("purity".to_string(), purity),
    ];
    if let Some(categories) = &filters.categories {
        params.push(("categories".to_string(), categories.clone()));
    }
    if let Some(sorting) = &filters.sorting {
        params.push(("sorting".to_string(), sorting.clone()));
    }
    if let Some(order) = &filters.order {
        params.push(("order".to_string(), order.clone()));
    }
    if let Some(atleast) = &filters.atleast {
        params.push(("atleast".to_string(), atleast.clone()));
    }
    if let Some(ratios) = &filters.ratios {
        params.push(("ratios".to_string(), ratios.clone()));
    }
    if has_key {
        // unwrap: has_key implies Some(non-empty).
        params.push(("apikey".to_string(), api_key.unwrap().to_string()));
    }
    params
}

fn map_item(item: WhItem) -> SourceItem {
    let ext = ext_from_file_type(&item.file_type).to_string();
    SourceItem {
        provider: SourceProvider::Wallhaven,
        id: item.id,
        thumb_url: item.thumbs.large,
        full_url: item.path,
        source_page_url: item.url,
        width: item.dimension_x,
        height: item.dimension_y,
        ext,
        author: None,
        license: None,
        attribution: None,
    }
}

fn parse_response(body: &str) -> AppResult<SourceSearchResult> {
    let resp: WhResponse = serde_json::from_str(body)
        .map_err(|err| AppError::Network(format!("wallhaven: unexpected response: {err}")))?;
    Ok(SourceSearchResult {
        items: resp.data.into_iter().map(map_item).collect(),
        page: resp.meta.current_page,
        last_page: resp.meta.last_page,
    })
}

pub async fn search(
    client: &reqwest::Client,
    query: &str,
    page: u32,
    filters: &SourceFilters,
    api_key: Option<&str>,
) -> AppResult<SourceSearchResult> {
    let params = build_query(query, page, filters, api_key);
    let body = client
        .get(SEARCH_URL)
        .query(&params)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    parse_response(&body)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"{
      "data": [
        {
          "id": "abc123",
          "url": "https://wallhaven.cc/w/abc123",
          "short_url": "https://whvn.cc/abc123",
          "path": "https://w.wallhaven.cc/full/ab/wallhaven-abc123.png",
          "file_type": "image/png",
          "dimension_x": 3840,
          "dimension_y": 2160,
          "thumbs": {
            "large": "https://th.wallhaven.cc/lg/ab/abc123.jpg",
            "original": "https://th.wallhaven.cc/orig/ab/abc123.jpg",
            "small": "https://th.wallhaven.cc/small/ab/abc123.jpg"
          }
        }
      ],
      "meta": { "current_page": 2, "last_page": 50, "per_page": 24, "total": 1200 }
    }"#;

    #[test]
    fn parses_items_and_meta() {
        let result = parse_response(FIXTURE).expect("parse");
        assert_eq!(result.page, 2);
        assert_eq!(result.last_page, 50);
        assert_eq!(result.items.len(), 1);
        let item = &result.items[0];
        assert_eq!(item.id, "abc123");
        assert_eq!(item.thumb_url, "https://th.wallhaven.cc/lg/ab/abc123.jpg");
        assert_eq!(
            item.full_url,
            "https://w.wallhaven.cc/full/ab/wallhaven-abc123.png"
        );
        assert_eq!(item.source_page_url, "https://wallhaven.cc/w/abc123");
        assert_eq!(item.width, 3840);
        assert_eq!(item.height, 2160);
        assert_eq!(item.ext, "png");
    }

    #[test]
    fn forces_sfw_without_key() {
        let filters = SourceFilters {
            purity: Some("111".into()), // caller asks for everything…
            ..Default::default()
        };
        let params = build_query("cats", 1, &filters, None);
        let purity = params.iter().find(|(k, _)| k == "purity").map(|(_, v)| v);
        assert_eq!(purity, Some(&"100".to_string())); // …but no key → SFW only
        assert!(!params.iter().any(|(k, _)| k == "apikey"));
    }

    #[test]
    fn honors_purity_and_key_when_present() {
        let filters = SourceFilters {
            purity: Some("110".into()),
            ..Default::default()
        };
        let params = build_query("cats", 3, &filters, Some("secret"));
        let purity = params.iter().find(|(k, _)| k == "purity").map(|(_, v)| v);
        assert_eq!(purity, Some(&"110".to_string()));
        let key = params.iter().find(|(k, _)| k == "apikey").map(|(_, v)| v);
        assert_eq!(key, Some(&"secret".to_string()));
        let page = params.iter().find(|(k, _)| k == "page").map(|(_, v)| v);
        assert_eq!(page, Some(&"3".to_string()));
    }

    #[test]
    fn includes_resolution_and_ratio_filters() {
        let filters = SourceFilters {
            atleast: Some("1920x1080".into()),
            ratios: Some("landscape".into()),
            ..Default::default()
        };
        let params = build_query("cats", 1, &filters, None);
        assert!(params.contains(&("atleast".to_string(), "1920x1080".to_string())));
        assert!(params.contains(&("ratios".to_string(), "landscape".to_string())));
    }

    #[test]
    fn empty_key_is_treated_as_no_key() {
        let filters = SourceFilters {
            purity: Some("001".into()),
            ..Default::default()
        };
        let params = build_query("x", 1, &filters, Some(""));
        let purity = params.iter().find(|(k, _)| k == "purity").map(|(_, v)| v);
        assert_eq!(purity, Some(&"100".to_string()));
        assert!(!params.iter().any(|(k, _)| k == "apikey"));
    }
}
