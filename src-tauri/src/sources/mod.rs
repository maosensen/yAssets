//! Third-party image source providers for the Discover feature. A provider
//! turns a search query into a page of `SourceItem`s — a remote thumbnail to
//! show, a full-res URL to download on import, and provenance. ALL network I/O
//! lives here (via reqwest); the webview only hotlinks provider thumbnails.

pub mod iconify;
pub mod openverse;
pub mod pexels;
pub mod pixabay;
pub mod wallhaven;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum SourceProvider {
    Wallhaven,
    Pixabay,
    Openverse,
    Pexels,
    Iconify,
}

/// One browsable result from a provider.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct SourceItem {
    pub provider: SourceProvider,
    /// Provider-native id (grid key + dedupe).
    pub id: String,
    /// Remote thumbnail URL, shown directly in an `<img>` (CSP-allowlisted host).
    pub thumb_url: String,
    /// Full-resolution URL — downloaded by Rust on import, never by the webview.
    pub full_url: String,
    /// The provider page for this item; stored as the imported asset's `source`.
    pub source_page_url: String,
    pub width: u32,
    pub height: u32,
    /// File extension of the full-res asset (e.g. "jpg", "png").
    pub ext: String,
    /// Attribution, when the provider supplies it (Pexels/Openverse).
    pub author: Option<String>,
    pub license: Option<String>,
    /// A ready-made, human-readable attribution line, when the provider gives
    /// one (Openverse). Recorded on the imported asset's note for licenses that
    /// require credit. Providers without one leave it `None` and the importer
    /// falls back to `author` + `license`.
    pub attribution: Option<String>,
}

/// A page of search results.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct SourceSearchResult {
    pub items: Vec<SourceItem>,
    pub page: u32,
    pub last_page: u32,
}

/// Provider-agnostic search filters. A flat bag of optionals: each provider
/// reads only the fields it understands and ignores the rest, so the frontend
/// can keep one filter state per provider without a type per source.
#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
pub struct SourceFilters {
    /// Wallhaven category bitmask "general/anime/people", e.g. "111".
    pub categories: Option<String>,
    /// Wallhaven purity bitmask "sfw/sketchy/nsfw", e.g. "100". Enforced to SFW
    /// server-side when no API key is present.
    pub purity: Option<String>,
    /// e.g. "date_added" | "relevance" | "views" | "toplist".
    pub sorting: Option<String>,
    /// "desc" | "asc".
    pub order: Option<String>,
    /// Wallhaven minimum resolution, e.g. "1920x1080".
    pub atleast: Option<String>,
    /// Wallhaven aspect ratios, e.g. "landscape" | "portrait" | "1x1".
    pub ratios: Option<String>,
    /// Pixabay image type: "photo" | "illustration" | "vector".
    pub image_type: Option<String>,
    /// Pixabay "horizontal" | "vertical"; Pexels "landscape" | "portrait" | "square".
    pub orientation: Option<String>,
    /// Pexels minimum size: "large" | "medium" | "small".
    pub size: Option<String>,
    /// Openverse license bucket: "commercial" | "modification".
    pub license_type: Option<String>,
    /// Openverse category: "photograph" | "illustration" | "digitized_artwork".
    pub category: Option<String>,
    /// Openverse aspect ratio: "wide" | "tall" | "square".
    pub aspect_ratio: Option<String>,
    /// Iconify icon-set prefix, e.g. "mdi".
    pub prefix: Option<String>,
    /// Iconify: true = color icon sets only, false = monochrome only.
    pub palette: Option<bool>,
}
