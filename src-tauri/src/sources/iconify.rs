//! Iconify provider (<https://api.iconify.design>). Keyless search across 150+
//! open-source icon sets (200k+ icons). Results are SVG: monochrome icons use
//! `currentColor`, so the grid colors the thumbnail for visibility while the
//! imported original stays recolorable. Per-set license + author come from the
//! search response's `collections` map and are recorded on the imported asset.

use std::collections::HashMap;

use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::sources::{SourceFilters, SourceItem, SourceProvider, SourceSearchResult};

const SEARCH_URL: &str = "https://api.iconify.design/search";
/// The API clamps `limit` to [32, 999]; we page through matches via `start`.
const PER_PAGE: u32 = 120;

#[derive(Debug, Deserialize)]
struct IcResponse {
    #[serde(default)]
    icons: Vec<String>,
    /// Total matches — drives pagination.
    #[serde(default)]
    total: u32,
    /// Per-prefix metadata (set name, author, license) for the returned icons.
    #[serde(default)]
    collections: HashMap<String, IcCollection>,
}

#[derive(Debug, Deserialize)]
struct IcCollection {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    author: Option<IcAuthor>,
    #[serde(default)]
    license: Option<IcLicense>,
}

#[derive(Debug, Deserialize)]
struct IcAuthor {
    #[serde(default)]
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct IcLicense {
    #[serde(default)]
    title: Option<String>,
}

/// Map an "prefix:name" id to a `SourceItem`, dropping malformed ids.
fn map_icon(id: &str, collections: &HashMap<String, IcCollection>) -> Option<SourceItem> {
    let (prefix, name) = id.split_once(':')?;
    if prefix.is_empty() || name.is_empty() {
        return None;
    }
    let collection = collections.get(prefix);
    let set_name = collection.and_then(|c| c.name.clone());
    let author = collection
        .and_then(|c| c.author.as_ref())
        .and_then(|a| a.name.clone());
    let license = collection
        .and_then(|c| c.license.as_ref())
        .and_then(|l| l.title.clone());
    // A provenance line good for icons: "mdi:home — Material Design Icons (Apache 2.0)".
    let attribution = set_name.as_ref().map(|set| match &license {
        Some(lic) => format!("{id} — {set} ({lic})"),
        None => format!("{id} — {set}"),
    });

    Some(SourceItem {
        provider: SourceProvider::Iconify,
        id: id.to_string(),
        // The plain SVG endpoint: raw currentColor for import; the grid appends
        // a `?color=` for a visible, theme-following thumbnail.
        thumb_url: format!("https://api.iconify.design/{prefix}/{name}.svg"),
        // `height=auto` writes the viewBox size (e.g. 24) into width/height —
        // without it the SVG says `1em` and imports as a 12×12 asset.
        full_url: format!("https://api.iconify.design/{prefix}/{name}.svg?height=auto"),
        source_page_url: format!("https://icon-sets.iconify.design/{prefix}/{name}/"),
        // Icons are square; a 1:1 ratio lays them out cleanly in the grid.
        width: 1,
        height: 1,
        ext: "svg".to_string(),
        author,
        license,
        attribution,
    })
}

fn parse_response(body: &str, page: u32) -> AppResult<SourceSearchResult> {
    let resp: IcResponse = serde_json::from_str(body)
        .map_err(|err| AppError::Network(format!("iconify: unexpected response: {err}")))?;
    let last_page = resp.total.div_ceil(PER_PAGE).max(1);
    let items = resp
        .icons
        .iter()
        .filter_map(|id| map_icon(id, &resp.collections))
        .collect();
    Ok(SourceSearchResult {
        items,
        page,
        last_page,
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
    let trimmed = query.trim();
    // Search needs a term; show nothing until the user types one.
    if trimmed.is_empty() {
        return Ok(SourceSearchResult {
            items: Vec::new(),
            page,
            last_page: 1,
        });
    }
    let start = (page - 1) * PER_PAGE;
    let mut params = vec![
        ("query", trimmed.to_string()),
        ("limit", PER_PAGE.to_string()),
        ("start", start.to_string()),
    ];
    if let Some(prefix) = &filters.prefix {
        params.push(("prefix", prefix.clone()));
    }
    if let Some(palette) = filters.palette {
        params.push(("palette", palette.to_string()));
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
      "icons": ["mdi:home", "solar:home-linear", "no-colon", ":empty", "bad:"],
      "total": 240,
      "limit": 120,
      "start": 0,
      "collections": {
        "mdi": {
          "name": "Material Design Icons",
          "author": { "name": "Pictogrammers", "url": "https://github.com/Templarian/MaterialDesign" },
          "license": { "title": "Apache 2.0", "spdx": "Apache-2.0" }
        },
        "solar": {
          "name": "Solar",
          "author": { "name": "480 Design" },
          "license": { "title": "CC BY 4.0" }
        }
      }
    }"#;

    #[test]
    fn parses_icons_pagination_and_attribution() {
        let result = parse_response(FIXTURE, 1).expect("parse");
        assert_eq!(result.page, 1);
        // 240 total / 120 per page = 2 pages.
        assert_eq!(result.last_page, 2);
        // Malformed ids ("no-colon", ":empty", "bad:") are dropped.
        assert_eq!(result.items.len(), 2);

        let mdi = &result.items[0];
        assert_eq!(mdi.provider, SourceProvider::Iconify);
        assert_eq!(mdi.id, "mdi:home");
        assert_eq!(mdi.thumb_url, "https://api.iconify.design/mdi/home.svg");
        assert_eq!(
            mdi.full_url,
            "https://api.iconify.design/mdi/home.svg?height=auto"
        );
        assert_eq!(
            mdi.source_page_url,
            "https://icon-sets.iconify.design/mdi/home/"
        );
        assert_eq!(mdi.ext, "svg");
        assert_eq!((mdi.width, mdi.height), (1, 1));
        assert_eq!(mdi.author.as_deref(), Some("Pictogrammers"));
        assert_eq!(mdi.license.as_deref(), Some("Apache 2.0"));
        assert_eq!(
            mdi.attribution.as_deref(),
            Some("mdi:home — Material Design Icons (Apache 2.0)")
        );

        let solar = &result.items[1];
        assert_eq!(solar.id, "solar:home-linear");
        assert_eq!(
            solar.thumb_url,
            "https://api.iconify.design/solar/home-linear.svg"
        );
        assert_eq!(
            solar.attribution.as_deref(),
            Some("solar:home-linear — Solar (CC BY 4.0)")
        );
    }

    #[test]
    fn unknown_prefix_has_no_attribution() {
        let body = r#"{ "icons": ["ph:cat"], "total": 1, "collections": {} }"#;
        let result = parse_response(body, 1).expect("parse");
        assert_eq!(result.items.len(), 1);
        let item = &result.items[0];
        assert_eq!(item.id, "ph:cat");
        assert!(item.author.is_none());
        assert!(item.license.is_none());
        assert!(item.attribution.is_none());
    }
}
