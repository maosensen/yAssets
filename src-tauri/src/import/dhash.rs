//! Perceptual fingerprint for duplicate detection — 64-bit difference hash.
//!
//! The library's layered duplicate strategy:
//! - **L1 exact** — blake3 content hash (import pipeline): byte-identical
//!   files. Deterministic; drives the interactive Duplicate Alert.
//! - **L2 visual** — this dHash: grayscale 9×8 box-downsample, then compare
//!   each pixel to its right neighbor → 64 bits. Robust against re-encodes,
//!   resizes and format conversions; Hamming distance ≤
//!   [`SIMILAR_MAX_DISTANCE`] flags "visually the same".
//!
//! Computed from the (≤512px) thumbnail RGBA during import/backfill and
//! stored bit-cast in `assets.dhash` (INTEGER/i64). Whole-library similarity
//! scans are a popcount loop — microseconds at any realistic library size.

/// Hamming distance at or below this counts as a visual-duplicate candidate.
#[allow(dead_code)] // consumed by the upcoming find-similar surface
pub const SIMILAR_MAX_DISTANCE: u32 = 5;

/// Downsample grid: 9 columns × 8 rows → 8 comparisons × 8 rows = 64 bits.
const GRID_W: usize = 9;
const GRID_H: usize = 8;

/// Compute the 64-bit dHash of an RGBA buffer (row-major, `w`×`h`).
/// Returns `None` for degenerate input (empty or short buffer).
pub fn compute(rgba: &[u8], w: u32, h: u32) -> Option<u64> {
    let (w, h) = (w as usize, h as usize);
    if w == 0 || h == 0 || rgba.len() < w * h * 4 {
        return None;
    }

    // Box-average luma per grid cell. Cell bounds guarantee ≥1 source pixel
    // even for images narrower than the grid.
    let mut cells = [[0u64; GRID_W]; GRID_H];
    for (gy, row) in cells.iter_mut().enumerate() {
        let y0 = gy * h / GRID_H;
        let y1 = (((gy + 1) * h) / GRID_H).max(y0 + 1).min(h.max(y0 + 1));
        for (gx, cell) in row.iter_mut().enumerate() {
            let x0 = gx * w / GRID_W;
            let x1 = (((gx + 1) * w) / GRID_W).max(x0 + 1).min(w.max(x0 + 1));
            let mut sum = 0u64;
            let mut count = 0u64;
            for y in y0..y1.min(h) {
                for x in x0..x1.min(w) {
                    let p = (y * w + x) * 4;
                    // Rec. 601 integer luma.
                    let luma = 299 * u64::from(rgba[p])
                        + 587 * u64::from(rgba[p + 1])
                        + 114 * u64::from(rgba[p + 2]);
                    sum += luma;
                    count += 1;
                }
            }
            *cell = sum.checked_div(count).unwrap_or(0);
        }
    }

    // Each bit: is this cell brighter than its right neighbor?
    let mut hash = 0u64;
    for row in &cells {
        for x in 0..GRID_W - 1 {
            hash = (hash << 1) | u64::from(row[x] > row[x + 1]);
        }
    }
    Some(hash)
}

/// Hamming distance between two dHashes.
pub fn distance(a: u64, b: u64) -> u32 {
    (a ^ b).count_ones()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Horizontal gradient — every right neighbor is brighter.
    fn gradient(w: u32, h: u32, offset: u8) -> Vec<u8> {
        let mut buf = Vec::with_capacity((w * h * 4) as usize);
        for _y in 0..h {
            for x in 0..w {
                let v = ((x * 255 / w.max(1)) as u8).saturating_add(offset);
                buf.extend_from_slice(&[v, v, v, 255]);
            }
        }
        buf
    }

    #[test]
    fn identical_images_have_zero_distance() {
        let a = compute(&gradient(200, 100, 0), 200, 100).unwrap();
        let b = compute(&gradient(200, 100, 0), 200, 100).unwrap();
        assert_eq!(distance(a, b), 0);
    }

    #[test]
    fn resized_image_stays_within_similarity_threshold() {
        // Same gradient at different resolutions — the classic re-encode case.
        let a = compute(&gradient(512, 384, 0), 512, 384).unwrap();
        let b = compute(&gradient(97, 61, 0), 97, 61).unwrap();
        assert!(distance(a, b) <= SIMILAR_MAX_DISTANCE);
    }

    #[test]
    fn brightness_shift_stays_within_similarity_threshold() {
        // dHash compares neighbors, so a uniform brightness lift barely moves it.
        let a = compute(&gradient(200, 100, 0), 200, 100).unwrap();
        let b = compute(&gradient(200, 100, 30), 200, 100).unwrap();
        assert!(distance(a, b) <= SIMILAR_MAX_DISTANCE);
    }

    #[test]
    fn different_images_are_far_apart() {
        // Gradient vs. its mirror — every comparison flips.
        let normal = gradient(144, 96, 0);
        let mut mirrored = Vec::with_capacity(normal.len());
        for y in 0..96usize {
            for x in 0..144usize {
                let p = (y * 144 + (143 - x)) * 4;
                mirrored.extend_from_slice(&normal[p..p + 4]);
            }
        }
        let a = compute(&normal, 144, 96).unwrap();
        let b = compute(&mirrored, 144, 96).unwrap();
        assert!(distance(a, b) > 40, "distance was {}", distance(a, b));
    }

    #[test]
    fn degenerate_input_is_rejected() {
        assert_eq!(compute(&[], 0, 0), None);
        assert_eq!(compute(&[0, 0, 0], 10, 10), None);
        // Tiny-but-valid images still hash.
        assert!(compute(&[128, 128, 128, 255], 1, 1).is_some());
    }
}
