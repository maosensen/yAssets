// Registers @testing-library/jest-dom matchers (toBeInTheDocument, etc.) on
// Vitest's `expect`, and augments its types. Loaded via test.setupFiles.
import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// RTL's auto-cleanup needs a global `afterEach`, which vitest only provides
// with `globals: true`. Register it explicitly so renders never leak across
// tests (duplicate elements → "found multiple elements" errors).
afterEach(() => {
	cleanup();
});
