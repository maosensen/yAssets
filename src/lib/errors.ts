/**
 * Typed mirror of the Rust `AppError` enum (`src-tauri/src/error.rs`).
 *
 * Commands return `Result<T, AppError>`; on failure Tauri rejects the `invoke`
 * promise with this serialized shape (`#[serde(tag = "code", content = "detail")]`).
 * Branch on the stable `code` for UI/retry decisions; `detail` is for display
 * and logging only. Keep this union in sync with the Rust enum variants.
 */
export type CommandError =
	| { code: "NotFound"; detail: string }
	| { code: "Io"; detail: string }
	| { code: "Db"; detail: string }
	| { code: "Internal" };

/** Narrow an unknown thrown value (e.g. from a rejected `invoke`) to a CommandError. */
export function isCommandError(error: unknown): error is CommandError {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		typeof (error as { code: unknown }).code === "string"
	);
}
