# Server icon

`mkkey-icon.png` is the original 192 × 192 PNG supplied for this server:

https://s3.ap-northeast-2.wasabisys.com/mkkey/data/90e0bd25-91e9-46b4-b58c-6de87d03833c.png

The image is stored locally; displaying it does not depend on the object storage.
Run `node scripts/build-brand-icons.mjs` from the repository root to regenerate
the frontend icon, software information icon, favicon, Apple touch icon, splash,
email header icon, PWA icons and legacy CherryPick SVG path. This uses the existing
backend `sharp` dependency and preserves transparency and aspect ratio.

PWA icons use `purpose: any` because this artwork has no maskable safe-area padding.
