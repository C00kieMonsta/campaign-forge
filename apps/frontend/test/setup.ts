// Global setup for the frontend Jest project (jsdom).

import { TextDecoder, TextEncoder } from "node:util";

// jsdom exposes neither TextEncoder nor TextDecoder, but React's server renderer reaches for them
// at import time. Node has had both since v11; jsdom simply doesn't put them on its global.
// Assigned only when absent, so a future jsdom that provides them wins.
const globals = globalThis as unknown as Record<string, unknown>;
if (!globals.TextEncoder) globals.TextEncoder = TextEncoder;
if (!globals.TextDecoder) globals.TextDecoder = TextDecoder;
