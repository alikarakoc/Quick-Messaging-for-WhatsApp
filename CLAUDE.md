# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Quick Messaging for WhatsApp** is a Chrome extension (Manifest V3) that lets users send WhatsApp messages to any phone number without saving the contact. Available on the [Chrome Web Store](https://chromewebstore.google.com/detail/quick-messaging-for-whats/pekcjcliklplmbpgceijjfpeoceblcpk).

## Development Setup

Zero-build, zero-dependency static browser extension. No npm, no bundler, no test framework.

**To develop locally**: Load the repository root as an unpacked extension via `chrome://extensions` → "Load unpacked". After any code change, click the reload icon on the extension card.

## Architecture

Three runtime contexts, clearly separated:

| File | Context | Purpose |
|------|---------|---------|
| `popup.html` + `popup.js` | Extension popup | UI, phone validation, send action |
| `content.js` | Injected into `web.whatsapp.com` only | Auto-clicks the WhatsApp send button after page loads |
| `background.js` | Not used | Placeholder (no service worker needed) |

### Send Flow

1. User enters phone number → validated live via `intl-tel-input` + `libphonenumber` (E.164 format stored in `validatedNumber`)
2. On send, `handleSend()` in `popup.js` queries all open tabs
3. If a `https://web.whatsapp.com/` tab exists, navigates it to the send URL; otherwise creates a new tab
4. Send URL: `https://web.whatsapp.com/send?phone=<E.164>&text=<msg>&app_absent=0`
5. On the WhatsApp Web tab, `content.js` polls every 200ms for the loading spinner (`.ZJWuG`) to appear then disappear, then auto-clicks the send button (`button.epia9gcq`)

### Country Detection

`popup.js` calls `https://ipapi.co/json/` via `fetch` to detect the user's country for the default dial code, falling back to `'TR'` on failure. Requires `https://ipapi.co/*` in `host_permissions`.

### Phone Number Libraries

- `scripts/intlTelInput.min.js` — phone input UI, loaded as `<script>` in popup.html
- `scripts/libphonenumber-max.js` — phone number parsing, loaded as `<script>` in popup.html
- `scripts/utils.js` — loaded asynchronously by intl-tel-input via `utilsScript: chrome.runtime.getURL('/scripts/utils.js')`

## Permissions

- `tabs` — query and update tabs (no `activeTab` needed)
- `host_permissions: https://web.whatsapp.com/*` — navigate WhatsApp Web tabs; triggers content script injection
- `host_permissions: https://ipapi.co/*` — geo-IP lookup for default dial code

## Styling

`css/style.css` uses CSS custom properties (`--clr-*`) for all colours. Dark mode is implemented via `@media (prefers-color-scheme: dark)` — no JavaScript needed. The popup width is controlled by `--popup-width: 360px` on `:root`.

## Fragile WhatsApp Selectors

Two CSS selectors in `content.js` are tied to WhatsApp Web's internal obfuscated class names and **will break** if WhatsApp updates their frontend:

- `.ZJWuG` — the loading spinner (polled to detect page load)
- `button.epia9gcq` — the send button that gets auto-clicked

When these break, inspect WhatsApp Web's DOM on a send URL to find the new selectors.
