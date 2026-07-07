//! Pexels provider (<https://api.pexels.com/v1/>). Requires a free API key,
//! sent in the `Authorization` header (never a query param, so it can't leak
//! into a logged URL). The Pexels License permits use but asks for credit, so
//! we record "Photo by <name> on Pexels" plus the photo page on import. An
//! empty query falls back to the curated feed for a browsable default.

use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::sources::{SourceFilters, SourceItem, SourceProvider, SourceSearchResult};

const SEARCH_URL: &str = "https://api.pexels.com/v1/search";
const CURATED_URL: &str = "https://api.pexels.com/v1/curated";
/// Pexels caps `per_page` at 80.
const PER_PAGE: u32 = 40;

#[derive(Debug, Deserialize)]
struct PxlResponse {
    page: u32,
    photos: Vec<PxlPhoto>,
    /// A URL string when another page exists; omitted on the last page.
    #[serde(default)]
    next_page: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PxlPhoto {
    id: u64,
    #[serde(default)]
    width: u32,
    #[serde(default)]
    height: u32,
    /// The photo's page on pexels.com — stored as provenance.
    url: String,
    #[serde(default)]
    photographer: String,
    src: PxlSrc,
}

#[derive(Debug, Deserialize)]
struct PxlSrc {
    /// Full-resolution original, downloaded on import.
    original: String,
    /// ~940px, shown in the grid.
    large: String,
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

fn map_photo(photo: PxlPhoto) -> SourceItem {
    let author = if photo.photographer.is_empty() {
        None
    } else {
        Some(photo.photographer.clone())
    };
    let attribution = author
        .as_deref()
        .map(|name| format!("Photo by {name} on Pexels"));
    SourceItem {
        provider: SourceProvider::Pexels,
        id: photo.id.to_string(),
        ext: ext_from_url(&photo.src.original),
        thumb_url: photo.src.large,
        full_url: photo.src.original,
        source_page_url: photo.url,
        width: photo.width,
        height: photo.height,
        author,
        license: Some("Pexels License".to_string()),
        attribution,
    }
}

fn parse_response(body: &str) -> AppResult<SourceSearchResult> {
    let resp: PxlResponse = serde_json::from_str(body)
        .map_err(|err| AppError::Network(format!("pexels: unexpected response: {err}")))?;
    let page = resp.page.max(1);
    // Pexels caps total results; drive pagination off `next_page` so we never
    // request past the last available page.
    let last_page = if resp.next_page.is_some() {
        page + 1
    } else {
        page
    };
    Ok(SourceSearchResult {
        items: resp.photos.into_iter().map(map_photo).collect(),
        page,
        last_page,
    })
}

pub async fn search(
    client: &reqwest::Client,
    query: &str,
    page: u32,
    _filters: &SourceFilters,
    api_key: Option<&str>,
) -> AppResult<SourceSearchResult> {
    let key = api_key.filter(|k| !k.is_empty()).ok_or_else(|| {
        AppError::Conflict("Pexels requires an API key (set it in Preferences)".into())
    })?;
    let page = page.max(1);
    let page_s = page.to_string();
    let per_page = PER_PAGE.to_string();
    let trimmed = query.trim();

    // Search needs a term; with none, show the curated feed instead of erroring.
    let request = if trimmed.is_empty() {
        client
            .get(CURATED_URL)
            .query(&[("page", page_s.as_str()), ("per_page", per_page.as_str())])
    } else {
        client.get(SEARCH_URL).query(&[
            ("query", trimmed),
            ("page", page_s.as_str()),
            ("per_page", per_page.as_str()),
        ])
    };

    let body = request
        .header("Authorization", key)
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
      "page": 2,
      "per_page": 40,
      "total_results": 8000,
      "photos": [
        {
          "id": 2014422,
          "width": 3024,
          "height": 3024,
          "url": "https://www.pexels.com/photo/brown-rocks-2014422/",
          "photographer": "Joey Farina",
          "photographer_url": "https://www.pexels.com/@joey",
          "src": {
            "original": "https://images.pexels.com/photos/2014422/pexels-photo-2014422.jpeg",
            "large2x": "https://images.pexels.com/photos/2014422/pexels-photo-2014422.jpeg?auto=compress&h=650&w=940",
            "large": "https://images.pexels.com/photos/2014422/pexels-photo-2014422.jpeg?auto=compress&h=650&w=940"
          }
        }
      ],
      "next_page": "https://api.pexels.com/v1/search/?page=3&per_page=40&query=rocks"
    }"#;

    #[test]
    fn parses_photos_and_next_page() {
        let result = parse_response(FIXTURE).expect("parse");
        assert_eq!(result.page, 2);
        // next_page present → advertise one more page.
        assert_eq!(result.last_page, 3);
        assert_eq!(result.items.len(), 1);
        let item = &result.items[0];
        assert_eq!(item.provider, SourceProvider::Pexels);
        assert_eq!(item.id, "2014422");
        assert_eq!(
            item.thumb_url,
            "https://images.pexels.com/photos/2014422/pexels-photo-2014422.jpeg?auto=compress&h=650&w=940"
        );
        assert_eq!(
            item.full_url,
            "https://images.pexels.com/photos/2014422/pexels-photo-2014422.jpeg"
        );
        assert_eq!(
            item.source_page_url,
            "https://www.pexels.com/photo/brown-rocks-2014422/"
        );
        assert_eq!((item.width, item.height), (3024, 3024));
        assert_eq!(item.ext, "jpeg");
        assert_eq!(item.author.as_deref(), Some("Joey Farina"));
        assert_eq!(item.license.as_deref(), Some("Pexels License"));
        assert_eq!(
            item.attribution.as_deref(),
            Some("Photo by Joey Farina on Pexels")
        );
    }

    #[test]
    fn last_page_stops_without_next_page() {
        let body = r#"{ "page": 5, "per_page": 40, "photos": [] }"#;
        let result = parse_response(body).expect("parse");
        assert_eq!(result.page, 5);
        assert_eq!(result.last_page, 5);
        assert!(result.items.is_empty());
    }
}
