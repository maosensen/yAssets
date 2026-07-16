//! Authentication + transport guards for the Collect API.
//!
//! Threat model: the server binds loopback only, but *any local process* and —
//! more importantly — *any web page the user visits* can reach 127.0.0.1.
//! Three independent gates close that:
//! - a bearer token (the real gate; constant-time compared, never logged),
//! - an Origin allowlist (browser extensions only; drive-by pages send an
//!   `https://` Origin and are refused before the token is even looked at),
//! - a Host check (defeats DNS-rebinding, which changes Host but not Origin).

/// Token length in characters. 48 chars over a 62-symbol alphabet ≈ 285 bits.
const TOKEN_LEN: usize = 48;

const TOKEN_ALPHABET: [char; 62] = [
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i',
    'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'A', 'B',
    'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U',
    'V', 'W', 'X', 'Y', 'Z',
];

/// New random bearer token (nanoid draws from the OS CSPRNG).
pub fn generate_token() -> String {
    nanoid::nanoid!(TOKEN_LEN, &TOKEN_ALPHABET)
}

/// Validate an `Authorization` header value against the expected token.
pub fn token_matches(header: Option<&str>, expected: &str) -> bool {
    if expected.is_empty() {
        // No token provisioned yet — nothing can authenticate.
        return false;
    }
    let Some(value) = header else { return false };
    let Some(bearer) = value.strip_prefix("Bearer ") else {
        return false;
    };
    ct_eq(bearer.trim().as_bytes(), expected.as_bytes())
}

/// Constant-time byte comparison. The length check short-circuits, which is
/// fine: token length is public knowledge, its content is not.
fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Requests carrying an Origin must come from a browser extension. A missing
/// Origin is allowed (curl / native tooling) — the token remains the gate.
/// A web page's fetch always carries its `http(s)://` Origin, so drive-by
/// pages are refused here even if a token ever leaked into page context.
pub fn origin_allowed(origin: Option<&str>) -> bool {
    match origin {
        None => true,
        Some(origin) => {
            origin.starts_with("chrome-extension://")
                || origin.starts_with("moz-extension://")
                || origin.starts_with("safari-web-extension://")
        }
    }
}

/// The Host header must name this loopback server (DNS-rebinding defense: a
/// hostile page pointing `evil.example` at 127.0.0.1 sends `Host: evil.example`).
pub fn host_allowed(host: Option<&str>, port: u16) -> bool {
    let Some(host) = host else { return false };
    host == format!("127.0.0.1:{port}")
        || host == format!("localhost:{port}")
        || host == format!("[::1]:{port}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_tokens_are_long_and_distinct() {
        let a = generate_token();
        let b = generate_token();
        assert_eq!(a.chars().count(), TOKEN_LEN);
        assert!(a.chars().all(|c| c.is_ascii_alphanumeric()));
        assert_ne!(a, b);
    }

    #[test]
    fn token_matching_requires_exact_bearer() {
        assert!(token_matches(Some("Bearer secret123"), "secret123"));
        // Trailing whitespace from sloppy clients is tolerated.
        assert!(token_matches(Some("Bearer secret123 "), "secret123"));
        assert!(!token_matches(Some("Bearer wrong"), "secret123"));
        assert!(!token_matches(Some("secret123"), "secret123"));
        assert!(!token_matches(Some("bearer secret123"), "secret123"));
        assert!(!token_matches(None, "secret123"));
        // An unprovisioned token authenticates nothing — not even "".
        assert!(!token_matches(Some("Bearer "), ""));
        assert!(!token_matches(None, ""));
    }

    #[test]
    fn origins_are_extension_only() {
        assert!(origin_allowed(None));
        assert!(origin_allowed(Some("chrome-extension://abcdefg")));
        assert!(origin_allowed(Some("moz-extension://uuid-here")));
        assert!(!origin_allowed(Some("https://evil.example")));
        assert!(!origin_allowed(Some("http://127.0.0.1:41420")));
        assert!(!origin_allowed(Some("null")));
    }

    #[test]
    fn host_must_be_loopback_with_port() {
        assert!(host_allowed(Some("127.0.0.1:41420"), 41420));
        assert!(host_allowed(Some("localhost:41420"), 41420));
        assert!(host_allowed(Some("[::1]:41420"), 41420));
        assert!(!host_allowed(Some("127.0.0.1:41421"), 41420));
        assert!(!host_allowed(Some("evil.example:41420"), 41420));
        assert!(!host_allowed(Some("127.0.0.1"), 41420));
        assert!(!host_allowed(None, 41420));
    }
}
