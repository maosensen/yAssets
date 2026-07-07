//! Openverse provider (<https://api.openverse.org/v1/images/>). Keyless: an
//! anonymous request works (with modest rate limits), so there is no API key.
//! Results are Creative-Commons / public-domain licensed and aggregated from
//! many upstreams (Flickr, Wikimedia, …), so we always record the ready-made
//! `attribution` string on import. Sensitive results are excluded by default.

use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::sources::{SourceFilters, SourceItem, SourceProvider, SourceSearchResult};

const SEARCH_URL: &str = "https://api.openverse.org/v1/images/";
/// Openverse allows up to 500; keep pages modest for the anonymous rate limit.
const PAGE_SIZE: u32 = 40;

#[derive(Debug, Deserialize)]
struct OvResponse {
    /// Total accessible pages — drives pagination directly.
    page_count: u32,
    page: u32,
    results: Vec<OvResult>,
}

#[derive(Debug, Deserialize)]
struct OvResult {
    id: String,
    /// The upstream page for the work (Flickr, Wikimedia, …) — stored as source.
    foreign_landing_url: Option<String>,
    /// Full-resolution image on the upstream CDN (any host).
    url: Option<String>,
    /// Openverse-hosted thumbnail proxy (always `api.openverse.org`).
    thumbnail: Option<String>,
    creator: Option<String>,
    /// CC/PD code, e.g. "by-sa", "cc0", "pdm".
    license: Option<String>,
    license_version: Option<String>,
    /// Nullable — many upstreams omit it; we fall back to the URL extension.
    filetype: Option<String>,
    /// A ready-made, correctly-formatted credit line. Recorded on the asset.
    attribution: Option<String>,
    // Dimension-less upstreams (Flickr, Wikimedia, …) serialize these as an
    // explicit `null`, not an absent key — so they must be `Option` (a bare
    // `u32` + `#[serde(default)]` rejects `null` and fails the whole page).
    #[serde(default)]
    width: Option<u32>,
    #[serde(default)]
    height: Option<u32>,
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

/// Human-readable license label from Openverse's code + version, e.g.
/// "by-sa" + "2.0" → "CC BY-SA 2.0"; "cc0" + "1.0" → "CC0 1.0".
fn license_label(code: &str, version: Option<&str>) -> String {
    let base = match code {
        "cc0" => "CC0".to_string(),
        "pdm" => "Public Domain Mark".to_string(),
        other => format!("CC {}", other.to_uppercase()),
    };
    match version {
        Some(v) if !v.is_empty() && code != "pdm" => format!("{base} {v}"),
        _ => base,
    }
}

/// Map a result, dropping any that lack a usable image or thumbnail.
fn map_result(r: OvResult) -> Option<SourceItem> {
    let full_url = r.url?;
    let thumb_url = r.thumbnail?;
    let ext = r
        .filetype
        .as_deref()
        .filter(|f| !f.is_empty())
        .map(|f| f.to_ascii_lowercase())
        .unwrap_or_else(|| ext_from_url(&full_url));
    let source_page_url = r.foreign_landing_url.unwrap_or_else(|| full_url.clone());
    let license = r
        .license
        .as_deref()
        .filter(|c| !c.is_empty())
        .map(|code| license_label(code, r.license_version.as_deref()));
    Some(SourceItem {
        provider: SourceProvider::Openverse,
        id: r.id,
        thumb_url,
        full_url,
        source_page_url,
        width: r.width.unwrap_or(0),
        height: r.height.unwrap_or(0),
        ext,
        author: r.creator.filter(|c| !c.is_empty()),
        license,
        attribution: r.attribution.filter(|a| !a.is_empty()),
    })
}

fn parse_response(body: &str) -> AppResult<SourceSearchResult> {
    let resp: OvResponse = serde_json::from_str(body)
        .map_err(|err| AppError::Network(format!("openverse: unexpected response: {err}")))?;
    Ok(SourceSearchResult {
        items: resp.results.into_iter().filter_map(map_result).collect(),
        page: resp.page,
        last_page: resp.page_count.max(1),
    })
}

pub async fn search(
    client: &reqwest::Client,
    query: &str,
    page: u32,
    filters: &SourceFilters,
    _api_key: Option<&str>,
) -> AppResult<SourceSearchResult> {
    let page = page.max(1);
    let mut params = vec![
        ("q", query.to_string()),
        ("page", page.to_string()),
        ("page_size", PAGE_SIZE.to_string()),
    ];
    if let Some(license_type) = &filters.license_type {
        params.push(("license_type", license_type.clone()));
    }
    if let Some(category) = &filters.category {
        params.push(("category", category.clone()));
    }
    if let Some(aspect_ratio) = &filters.aspect_ratio {
        params.push(("aspect_ratio", aspect_ratio.clone()));
    }
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
      "result_count": 240,
      "page_count": 6,
      "page_size": 40,
      "page": 1,
      "results": [
        {
          "id": "f561777d-24ea-483f-9cf8-f17aa1fd6aa3",
          "title": "Mountains",
          "foreign_landing_url": "https://www.flickr.com/photos/22178197@N00/16129656628",
          "url": "https://live.staticflickr.com/7539/16129656628_ddd1db38c2_b.jpg",
          "creator": "Kamil Porembinski",
          "creator_url": "https://www.flickr.com/photos/22178197@N00",
          "license": "by-sa",
          "license_version": "2.0",
          "license_url": "https://creativecommons.org/licenses/by-sa/2.0/",
          "provider": "flickr",
          "filetype": null,
          "attribution": "\"Mountains\" by Kamil Porembinski is licensed under CC BY-SA 2.0.",
          "height": 680,
          "width": 1024,
          "thumbnail": "https://api.openverse.org/v1/images/f561777d-24ea-483f-9cf8-f17aa1fd6aa3/thumb/"
        },
        {
          "id": "no-image",
          "foreign_landing_url": "https://example.com/x",
          "url": null,
          "license": "cc0",
          "license_version": "1.0",
          "height": 10,
          "width": 10,
          "thumbnail": "https://api.openverse.org/v1/images/no-image/thumb/"
        }
      ]
    }"#;

    #[test]
    fn parses_results_and_pagination() {
        let result = parse_response(FIXTURE).expect("parse");
        assert_eq!(result.page, 1);
        assert_eq!(result.last_page, 6);
        // The second result has no `url` and is dropped.
        assert_eq!(result.items.len(), 1);
        let item = &result.items[0];
        assert_eq!(item.provider, SourceProvider::Openverse);
        assert_eq!(item.id, "f561777d-24ea-483f-9cf8-f17aa1fd6aa3");
        assert_eq!(
            item.thumb_url,
            "https://api.openverse.org/v1/images/f561777d-24ea-483f-9cf8-f17aa1fd6aa3/thumb/"
        );
        assert_eq!(
            item.full_url,
            "https://live.staticflickr.com/7539/16129656628_ddd1db38c2_b.jpg"
        );
        assert_eq!(
            item.source_page_url,
            "https://www.flickr.com/photos/22178197@N00/16129656628"
        );
        assert_eq!((item.width, item.height), (1024, 680));
        // filetype null → derived from the URL.
        assert_eq!(item.ext, "jpg");
        assert_eq!(item.author.as_deref(), Some("Kamil Porembinski"));
        assert_eq!(item.license.as_deref(), Some("CC BY-SA 2.0"));
        assert_eq!(
            item.attribution.as_deref(),
            Some("\"Mountains\" by Kamil Porembinski is licensed under CC BY-SA 2.0.")
        );
    }

    #[test]
    fn tolerates_null_dimensions() {
        // Openverse serializes missing dimensions as explicit `null` (key
        // present). The whole page must still parse; the item keeps 0x0.
        let body = r#"{
          "result_count": 1,
          "page_count": 1,
          "page": 1,
          "results": [
            {
              "id": "dimless",
              "foreign_landing_url": "https://example.com/x",
              "url": "https://cdn.example.com/x.jpg",
              "thumbnail": "https://api.openverse.org/v1/images/dimless/thumb/",
              "license": "cc0",
              "license_version": "1.0",
              "width": null,
              "height": null
            }
          ]
        }"#;
        let result = parse_response(body).expect("parse must not fail on null dims");
        assert_eq!(result.items.len(), 1);
        assert_eq!((result.items[0].width, result.items[0].height), (0, 0));
    }

    #[test]
    fn license_labels() {
        assert_eq!(license_label("by-sa", Some("2.0")), "CC BY-SA 2.0");
        assert_eq!(license_label("by-nc-nd", Some("4.0")), "CC BY-NC-ND 4.0");
        assert_eq!(license_label("cc0", Some("1.0")), "CC0 1.0");
        assert_eq!(license_label("pdm", Some("1.0")), "Public Domain Mark");
        assert_eq!(license_label("by", None), "CC BY");
    }
}
