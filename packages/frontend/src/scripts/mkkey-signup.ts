/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { mkkeySsoRequest } from '@/scripts/mkkey-sso.js';
import { login } from '@/account.js';
import * as os from '@/os.js';

export async function signinOrContinueMkkeySignup(oauthToken: string): Promise<'signedIn' | 'signup' | 'cancelled'> {
	let response = await mkkeySsoRequest<{ finished: boolean; i?: string; next?: string; }>('signin', { oauthToken });
	if (!response.finished && response.next === 'signup') return 'signup';
	if (!response.finished && response.next === 'totp') {
		const { canceled, result } = await os.inputText({ title: 'CherryPickの2段階認証コード', autocomplete: 'one-time-code' });
		if (canceled) return 'cancelled';
		response = await mkkeySsoRequest('signin', { oauthToken, token: result });
	}
	if (!response.finished || !response.i) throw new Error('MKKEY_AUTH_FAILED');
	await login(response.i);
	return 'signedIn';
}
