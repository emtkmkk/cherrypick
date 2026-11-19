/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../packages/backend/package.json', import.meta.url));
const sharp = require('sharp');
const root = new URL('../', import.meta.url);
const source = await readFile(new URL('assets/mkkey-icon.png', root));
const png = size => sharp(source).resize(size, size, { fit: 'contain' }).png().toBuffer();

// Preserve legacy asset paths as well, so they cannot fall back to the upstream icon.
for (const [path, size] of [
	['packages/frontend/assets/mkkey-icon.png', 192],
	['packages/frontend/assets/about-icon.png', 192],
	['packages/backend/assets/favicon.png', 128],
	['packages/backend/assets/apple-touch-icon.png', 256],
	['packages/backend/assets/mi-white.png', 288],
	['packages/backend/assets/splash.png', 300],
	['packages/backend/assets/icons/192.png', 192],
	['packages/backend/assets/icons/512.png', 512],
]) {
	await writeFile(new URL(path, root), size === 192 ? source : await png(size));
}

// ICO supports PNG frames; include the common favicon and Windows icon sizes.
const sizes = [16, 32, 48, 64, 128, 256];
const frames = await Promise.all(sizes.map(png));
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (const [index, size] of sizes.entries()) {
	const entry = 6 + index * 16;
	header[entry] = header[entry + 1] = size === 256 ? 0 : size;
	header.writeUInt16LE(1, entry + 4);
	header.writeUInt16LE(32, entry + 6);
	header.writeUInt32LE(frames[index].length, entry + 8);
	header.writeUInt32LE(offset, entry + 12);
	offset += frames[index].length;
}
await writeFile(new URL('packages/backend/assets/favicon.ico', root), Buffer.concat([header, ...frames]));

// Keep old direct links to the CherryPick wordmark on the same local branding.
await writeFile(new URL('packages/frontend/assets/cherrypick.svg', root),
	`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="192" height="192" viewBox="0 0 192 192"><image width="192" height="192" xlink:href="data:image/png;base64,${source.toString('base64')}"/></svg>\n`);
