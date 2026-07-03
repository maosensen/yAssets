//! Dominant-color analysis over a thumbnail's RGBA buffer.
//!
//! Cheap and good-enough for browsing: sample pixels, drop transparent and
//! near-white/near-black ones, bucket the rest by hue (12 × 30° slices), and
//! report the fullest bucket. Greyscale/low-saturation images fall into the
//! neutral bucket ([`NEUTRAL_HUE`]). The palette is a few representative
//! swatch hexes for display.

/// Bucket id for neutral / greyscale images (no meaningful hue).
pub const NEUTRAL_HUE: u8 = 12;
/// Number of chromatic buckets (30° each); neutral is the 13th.
pub const HUE_BUCKETS: u8 = 12;

/// Analyze a tightly-packed RGBA8 buffer. Returns (hue bucket, palette JSON).
/// `None` hue when the buffer is empty/degenerate.
pub fn analyze_rgba(rgba: &[u8]) -> (Option<u8>, Option<String>) {
    if rgba.len() < 4 {
        return (None, None);
    }
    // Cap the work: sample at most ~4096 pixels regardless of thumb size.
    let pixel_count = rgba.len() / 4;
    let step = (pixel_count / 4096).max(1) * 4;

    let mut bucket_counts = [0u32; (HUE_BUCKETS + 1) as usize];
    // Accumulate average color per chromatic bucket for the palette.
    let mut bucket_rgb = [[0u64; 3]; HUE_BUCKETS as usize];

    let mut i = 0;
    while i + 3 < rgba.len() {
        let (r, g, b, a) = (rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]);
        i += step;
        if a < 32 {
            continue; // transparent
        }
        let (hue, sat, val) = rgb_to_hsv(r, g, b);
        // Ignore near-black and near-white; treat washed-out as neutral.
        if val < 0.12 || (val > 0.95 && sat < 0.08) {
            continue;
        }
        if sat < 0.15 {
            bucket_counts[NEUTRAL_HUE as usize] += 1;
            continue;
        }
        let bucket = (((hue / 30.0) as u32) % HUE_BUCKETS as u32) as usize;
        bucket_counts[bucket] += 1;
        bucket_rgb[bucket][0] += r as u64;
        bucket_rgb[bucket][1] += g as u64;
        bucket_rgb[bucket][2] += b as u64;
    }

    // Dominant = fullest bucket; if only neutral saw hits, report neutral.
    let (dominant, &count) = bucket_counts
        .iter()
        .enumerate()
        .max_by_key(|(_, &c)| c)
        .expect("non-empty array");
    if count == 0 {
        return (None, None);
    }
    let hue = dominant as u8;

    // Palette: the three fullest chromatic buckets' average colors.
    let mut chromatic: Vec<(usize, u32)> = (0..HUE_BUCKETS as usize)
        .map(|b| (b, bucket_counts[b]))
        .filter(|(_, c)| *c > 0)
        .collect();
    chromatic.sort_by_key(|(_, count)| std::cmp::Reverse(*count));
    let swatches: Vec<String> = chromatic
        .iter()
        .take(3)
        .map(|(b, c)| {
            let n = (*c as u64).max(1);
            hex(
                (bucket_rgb[*b][0] / n) as u8,
                (bucket_rgb[*b][1] / n) as u8,
                (bucket_rgb[*b][2] / n) as u8,
            )
        })
        .collect();
    let palette = if swatches.is_empty() {
        None
    } else {
        serde_json::to_string(&swatches).ok()
    };

    (Some(hue), palette)
}

/// H in [0,360), S/V in [0,1].
fn rgb_to_hsv(r: u8, g: u8, b: u8) -> (f32, f32, f32) {
    let (rf, gf, bf) = (r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0);
    let max = rf.max(gf).max(bf);
    let min = rf.min(gf).min(bf);
    let delta = max - min;
    let hue = if delta < f32::EPSILON {
        0.0
    } else if max == rf {
        60.0 * (((gf - bf) / delta) % 6.0)
    } else if max == gf {
        60.0 * (((bf - rf) / delta) + 2.0)
    } else {
        60.0 * (((rf - gf) / delta) + 4.0)
    };
    let hue = if hue < 0.0 { hue + 360.0 } else { hue };
    let sat = if max <= f32::EPSILON {
        0.0
    } else {
        delta / max
    };
    (hue, sat, max)
}

fn hex(r: u8, g: u8, b: u8) -> String {
    format!("#{r:02x}{g:02x}{b:02x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid(r: u8, g: u8, b: u8, n: usize) -> Vec<u8> {
        std::iter::repeat([r, g, b, 255])
            .take(n)
            .flatten()
            .collect()
    }

    #[test]
    fn pure_red_buckets_to_hue_zero() {
        let (hue, palette) = analyze_rgba(&solid(220, 20, 20, 100));
        assert_eq!(hue, Some(0));
        assert!(palette.unwrap().contains("#"));
    }

    #[test]
    fn pure_blue_buckets_to_blue_slice() {
        let (hue, _) = analyze_rgba(&solid(20, 40, 220, 100));
        // ~234° → 234/30 = bucket 7 (210–240°).
        assert_eq!(hue, Some(7));
    }

    #[test]
    fn grey_is_neutral() {
        let (hue, _) = analyze_rgba(&solid(128, 128, 128, 100));
        assert_eq!(hue, Some(NEUTRAL_HUE));
    }

    #[test]
    fn fully_transparent_yields_none() {
        let rgba: Vec<u8> = std::iter::repeat([10u8, 200, 50, 0])
            .take(100)
            .flatten()
            .collect();
        assert_eq!(analyze_rgba(&rgba), (None, None));
    }

    #[test]
    fn empty_buffer_is_safe() {
        assert_eq!(analyze_rgba(&[]), (None, None));
    }
}
