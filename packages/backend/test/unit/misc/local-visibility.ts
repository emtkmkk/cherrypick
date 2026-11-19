/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { localVisibility } from '@/core/activitypub/misc/local-visibility.js';

describe('mkkey local visibility inheritance', () => {
	test('semi-public from a bubble peer becomes home without adding a followers restriction', () => {
		expect(localVisibility('mkkey.net', 'public', 'home', ['mkkey.net'])).toEqual({ visibility: 'home', localAndFollowers: false });
	});
	test.each(['public', 'home'] as const)('local %s with remote-followers enabled keeps the local scope and restriction flag', visibility => {
		expect(localVisibility('mkkey.net', 'followers', visibility, ['mkkey.net'])).toEqual({ visibility, localAndFollowers: true });
	});
	test('untrusted servers, direct posts and invalid extensions cannot widen visibility', () => {
		expect(localVisibility('evil.test', 'followers', 'public', ['mkkey.net'])).toEqual({ visibility: 'followers', localAndFollowers: false });
		expect(localVisibility('mkkey.net', 'specified', 'public', ['mkkey.net']).visibility).toBe('specified');
		expect(localVisibility('mkkey.net', 'followers', 'invalid', ['mkkey.net']).visibility).toBe('followers');
		expect(localVisibility('mkkey.net', 'public', 'home', undefined).visibility).toBe('public');
	});
});
