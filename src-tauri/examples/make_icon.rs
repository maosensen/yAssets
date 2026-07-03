//! One-off icon prep: turn a full-bleed square logo into an Apple-style
//! source icon — content scaled to 824px, centered on a 1024px transparent
//! canvas, with a ~22.4% (185px) anti-aliased rounded-corner mask — ready to
//! feed into `pnpm tauri icon <output>`.
//!
//! Usage: cargo run --example make_icon -- <source.png> <output.png>

use image::{imageops, Rgba, RgbaImage};

const CANVAS: u32 = 1024;
const CONTENT: u32 = 824;
const RADIUS: f32 = 185.0;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (src, dest) = (&args[1], &args[2]);
    let source = image::open(src).expect("open source image").to_rgba8();
    let content = imageops::resize(&source, CONTENT, CONTENT, imageops::FilterType::Lanczos3);

    let mut out = RgbaImage::from_pixel(CANVAS, CANVAS, Rgba([0, 0, 0, 0]));
    let offset = (CANVAS - CONTENT) / 2;
    let side = CONTENT as f32;

    for y in 0..CONTENT {
        for x in 0..CONTENT {
            let px = content.get_pixel(x, y);
            let fx = x as f32 + 0.5;
            let fy = y as f32 + 0.5;
            // Distance to the rounded-rect boundary: clamp the sample point
            // into the "inner" rect, then measure — 0 inside straight edges,
            // radial in the corner zones. ±0.5px band anti-aliases the edge.
            let cx = fx.clamp(RADIUS, side - RADIUS);
            let cy = fy.clamp(RADIUS, side - RADIUS);
            let d = ((fx - cx).powi(2) + (fy - cy).powi(2)).sqrt();
            let coverage = (RADIUS + 0.5 - d).clamp(0.0, 1.0);
            let alpha = (f32::from(px[3]) * coverage).round() as u8;
            out.put_pixel(x + offset, y + offset, Rgba([px[0], px[1], px[2], alpha]));
        }
    }

    out.save(dest).expect("save output image");
    println!("wrote {dest}");
}
