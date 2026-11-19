/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { validateHeaderValue } from 'node:http';
import { encodeOAuthErrorDescription } from '@/misc/oauth-error-description.js';

describe('OAuth error descriptions', () => {
	test('preserves existing ASCII descriptions', () => {
		expect(encodeOAuthErrorDescription('Insufficient permission.')).toBe('Insufficient permission.');
	});

	test.each(['リアクションできません。', 'Blocked 😅', 'A "quote" and \\ slash', 'first\r\nInjected: value'])(
		'can safely send an error header for %s', message => {
			const encoded = encodeOAuthErrorDescription(message);
			expect(() => validateHeaderValue('WWW-Authenticate', `Bearer error_description="${encoded}"`)).not.toThrow();
			expect(encoded).not.toMatch(/[^\x20\x21\x23-\x5B\x5D-\x7E]/u);
			expect(decodeURIComponent(encoded)).toBe(message);
		},
	);
});
