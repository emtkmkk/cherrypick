/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeEach, expect, test, vi } from 'vitest';
import { signinOrContinueMkkeySignup } from '@/utility/mkkey-signup.js';
import { mkkeySsoRequest } from '@/utility/mkkey-sso.js';
import { inputText } from '@/os.js';

vi.mock('@/utility/mkkey-sso.js', () => ({ mkkeySsoRequest: vi.fn() }));
vi.mock('@/os.js', () => ({ inputText: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); });

test('returns an unlinked identity to registration', async () => {
	vi.mocked(mkkeySsoRequest).mockResolvedValue({ finished: false, next: 'signup' });
	expect(await signinOrContinueMkkeySignup('proof')).toEqual({ type: 'signup' });
});

test('returns linked account credentials only after local two-factor authentication', async () => {
	vi.mocked(mkkeySsoRequest).mockResolvedValueOnce({ finished: false, next: 'totp' })
		.mockResolvedValueOnce({ finished: true, id: 'linked', i: 'native-token' });
	vi.mocked(inputText).mockResolvedValue({ canceled: false, result: '123456' });
	expect(await signinOrContinueMkkeySignup('proof')).toEqual({ type: 'signedIn', id: 'linked', token: 'native-token' });
	expect(mkkeySsoRequest).toHaveBeenLastCalledWith('signin', { oauthToken: 'proof', token: '123456' });
});

test('cancelling the two-factor prompt does not finish authentication', async () => {
	vi.mocked(mkkeySsoRequest).mockResolvedValue({ finished: false, next: 'totp' });
	vi.mocked(inputText).mockResolvedValue({ canceled: true, result: undefined });
	expect(await signinOrContinueMkkeySignup('proof')).toEqual({ type: 'cancelled' });
	expect(mkkeySsoRequest).toHaveBeenCalledTimes(1);
});
