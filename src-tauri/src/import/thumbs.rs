//! Thumbnail generation: decode → EXIF-orient → SIMD resize → lossy WebP.
//!
//! - Formats are gated by (lowercased) extension; content is still sniffed by
//!   `with_guessed_format`, so a mislabelled file decodes by its real format.
//! - Decompression bombs are bounded by `image::Limits` (dimensions + alloc);
//!   oversized files degrade to "imported without thumbnail", never a crash.
//! - Dimensions are recorded *after* EXIF orientation — the frontend masonry
//!   computes layout purely from these numbers, so portrait photos must
//!   report portrait dimensions.
//! - Encoding uses the `webp` crate (lossy, alpha-capable). The `image`
//!   crate's own WebP encoder is lossless-only — 3-5× larger files.

use std::path::Path;

use fast_image_resize::images::Image;
use fast_image_resize::{FilterType, PixelType, ResizeAlg, ResizeOptions, Resizer};
use image::metadata::Orientation;
use image::{DynamicImage, ImageDecoder, ImageReader};

use crate::error::{AppError, AppResult};

/// Long-edge target for generated thumbnails (px).
pub const THUMB_LONG_EDGE: u32 = 512;
/// Lossy WebP quality.
const WEBP_QUALITY: f32 = 80.0;
/// Decode guards: refuse absurd dimensions / allocations up front.
const MAX_DECODE_EDGE: u32 = 20_000;
const MAX_DECODE_ALLOC: u64 = 512 * 1024 * 1024;

/// Bitmap formats decoded by the `image` crate.
fn is_bitmap_ext(ext: &str) -> bool {
    matches!(ext, "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp")
}

/// Extensions we can generate a real thumbnail for (bitmaps + SVG).
pub fn is_thumbable_ext(ext: &str) -> bool {
    is_bitmap_ext(ext) || ext == "svg"
}

/// Result of thumbnailing: oriented source dimensions + extracted color +
/// perceptual fingerprint.
#[derive(Debug, Clone)]
pub struct ThumbOutcome {
    pub width: u32,
    pub height: u32,
    /// Dominant-hue bucket (see [`crate::import::color`]); None if undetermined.
    pub hue: Option<u8>,
    /// JSON array of representative swatch hex strings.
    pub palette: Option<String>,
    /// 64-bit dHash (see [`crate::import::dhash`]), bit-cast for storage.
    pub dhash: Option<i64>,
}

/// Decode `src` (bitmap or SVG), resize to ≤ [`THUMB_LONG_EDGE`], write a
/// WebP to `dest`, and extract the dominant color from the downscaled pixels.
///
/// Any error here is per-file and non-fatal to import — callers downgrade to
/// `has_thumb = false` and keep the asset.
pub fn generate(src: &Path, dest: &Path, ext: &str) -> AppResult<ThumbOutcome> {
    let (width, height, thumb_w, thumb_h, resized) = if ext == "svg" {
        rasterize_svg(src)?
    } else {
        decode_bitmap(src)?
    };

    let (hue, palette) = crate::import::color::analyze_rgba(&resized);
    let dhash = crate::import::dhash::compute(&resized, thumb_w, thumb_h).map(|v| v as i64);

    let encoded = webp::Encoder::from_rgba(&resized, thumb_w, thumb_h).encode(WEBP_QUALITY);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(dest, &*encoded)?;

    Ok(ThumbOutcome {
        width,
        height,
        hue,
        palette,
        dhash,
    })
}

/// Bitmap path: decode via `image` (EXIF-oriented, bomb-limited) → RGBA →
/// SIMD downscale. Returns (src_w, src_h, thumb_w, thumb_h, thumb_rgba).
fn decode_bitmap(src: &Path) -> AppResult<(u32, u32, u32, u32, Vec<u8>)> {
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_DECODE_EDGE);
    limits.max_image_height = Some(MAX_DECODE_EDGE);
    limits.max_alloc = Some(MAX_DECODE_ALLOC);

    let mut reader = ImageReader::open(src)?.with_guessed_format()?;
    reader.limits(limits);

    let mut decoder = reader.into_decoder().map_err(image_err)?;
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let mut img = DynamicImage::from_decoder(decoder).map_err(image_err)?;
    img.apply_orientation(orientation);

    let (width, height) = (img.width(), img.height());
    let (thumb_w, thumb_h) = fit_long_edge(width, height, THUMB_LONG_EDGE);
    let rgba = img.into_rgba8().into_raw();
    let resized = if (thumb_w, thumb_h) == (width, height) {
        rgba
    } else {
        resize_rgba(rgba, width, height, thumb_w, thumb_h)?
    };
    Ok((width, height, thumb_w, thumb_h, resized))
}

/// SVG path: parse with usvg, render at the thumbnail size with resvg/tiny-skia.
/// Reported dimensions are the SVG's intrinsic size; the raster is already the
/// thumbnail (no separate resize step).
fn rasterize_svg(src: &Path) -> AppResult<(u32, u32, u32, u32, Vec<u8>)> {
    let data = std::fs::read(src)?;
    let tree = resvg::usvg::Tree::from_data(&data, &resvg::usvg::Options::default())
        .map_err(|err| AppError::Io(format!("svg parse failed: {err}")))?;

    let size = tree.size();
    let (src_w, src_h) = (size.width().max(1.0), size.height().max(1.0));
    let (thumb_w, thumb_h) =
        fit_long_edge(src_w.ceil() as u32, src_h.ceil() as u32, THUMB_LONG_EDGE);

    let mut pixmap = resvg::tiny_skia::Pixmap::new(thumb_w.max(1), thumb_h.max(1))
        .ok_or_else(|| AppError::Io("svg pixmap alloc failed".into()))?;
    let scale = thumb_w as f32 / src_w;
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );

    Ok((
        src_w.ceil() as u32,
        src_h.ceil() as u32,
        thumb_w,
        thumb_h,
        pixmap.data().to_vec(),
    ))
}

/// SIMD resize via fast_image_resize (Lanczos3, alpha-aware mul/div).
fn resize_rgba(raw: Vec<u8>, src_w: u32, src_h: u32, dst_w: u32, dst_h: u32) -> AppResult<Vec<u8>> {
    let src = Image::from_vec_u8(src_w, src_h, raw, PixelType::U8x4).map_err(|err| {
        log::warn!("resize source buffer invalid: {err}");
        AppError::Internal
    })?;
    let mut dst = Image::new(dst_w, dst_h, PixelType::U8x4);
    Resizer::new()
        .resize(
            &src,
            &mut dst,
            &ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FilterType::Lanczos3)),
        )
        .map_err(|err| {
            log::warn!("resize failed: {err}");
            AppError::Internal
        })?;
    Ok(dst.into_vec())
}

/// Scale (w, h) so the long edge is ≤ `edge`, never upscaling.
fn fit_long_edge(width: u32, height: u32, edge: u32) -> (u32, u32) {
    let long = width.max(height);
    if long <= edge {
        return (width, height);
    }
    let scale = edge as f64 / long as f64;
    (
        ((width as f64 * scale).round() as u32).max(1),
        ((height as f64 * scale).round() as u32).max(1),
    )
}

fn image_err(err: image::ImageError) -> AppError {
    AppError::Io(format!("image decode failed: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fit_long_edge_downscales_and_never_upscales() {
        assert_eq!(fit_long_edge(4000, 3000, 512), (512, 384));
        assert_eq!(fit_long_edge(3000, 4000, 512), (384, 512));
        assert_eq!(fit_long_edge(400, 300, 512), (400, 300));
        assert_eq!(fit_long_edge(512, 512, 512), (512, 512));
        // Extreme panorama: short edge clamps to ≥ 1.
        assert_eq!(fit_long_edge(50_000_u32.min(20_000), 10, 512).1.max(1), 1);
    }

    #[test]
    fn generate_writes_webp_and_reports_dimensions() {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let src = tmp.path().join("src.png");
        let dest = tmp.path().join("out/th.webp");

        // 800×600 gradient with alpha.
        let img = image::RgbaImage::from_fn(800, 600, |x, y| {
            image::Rgba([(x % 256) as u8, (y % 256) as u8, 128, 200])
        });
        img.save(&src).expect("write fixture png");

        let outcome = generate(&src, &dest, "png").expect("generate");
        assert_eq!((outcome.width, outcome.height), (800, 600));
        assert!(outcome.hue.is_some());
        assert!(dest.is_file());

        // Round-trip: the written file decodes as a ≤512 long-edge image.
        let thumb = image::open(&dest).expect("decode thumb");
        assert_eq!(thumb.width().max(thumb.height()), 512);
    }

    #[test]
    fn generate_small_image_keeps_size() {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let src = tmp.path().join("small.png");
        let dest = tmp.path().join("th.webp");
        image::RgbaImage::from_pixel(120, 80, image::Rgba([10, 20, 30, 255]))
            .save(&src)
            .expect("fixture");

        let outcome = generate(&src, &dest, "png").expect("generate");
        assert_eq!((outcome.width, outcome.height), (120, 80));
        let thumb = image::open(&dest).expect("decode thumb");
        assert_eq!((thumb.width(), thumb.height()), (120, 80));
    }

    #[test]
    fn generate_rejects_non_image_bytes() {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let src = tmp.path().join("fake.png");
        let dest = tmp.path().join("th.webp");
        std::fs::write(&src, b"definitely not an image").expect("fixture");

        assert!(generate(&src, &dest, "png").is_err());
        assert!(!dest.exists());
    }

    #[test]
    fn generate_rasterizes_svg() {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let src = tmp.path().join("icon.svg");
        let dest = tmp.path().join("th.webp");
        std::fs::write(
            &src,
            br##"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#2244cc"/></svg>"##,
        )
        .expect("fixture");

        let outcome = generate(&src, &dest, "svg").expect("generate svg");
        assert_eq!((outcome.width, outcome.height), (200, 100));
        assert!(dest.is_file());
        assert_eq!(outcome.hue, Some(7)); // #2244cc ≈ 228° → blue slice
    }
}
