/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { mkkeySsoRequest } from '@/scripts/mkkey-sso.js';
import * as os from '@/os.js';

export type MkkeySignupResult = { type: 'signedIn'; id: string; token: string; } | { type: 'signup' | 'cancelled'; };

export async function signinOrContinueMkkeySignup(oauthToken: string): Promise<MkkeySignupResult> {
	let response = await mkkeySsoRequest<{ finished: boolean; id?: string; i?: string; next?: string; }>('signin', { oauthToken });
	if (!response.finished && response.next === 'signup') return { type: 'signup' };
	if (!response.finished && response.next === 'totp') {
		const { canceled, result } = await os.inputText({ title: 'CherryPickの2段階認証コード', autocomplete: 'one-time-code' });
		if (canceled) return { type: 'cancelled' };
		response = await mkkeySsoRequest('signin', { oauthToken, token: result });
	}
	if (!response.finished || !response.id || !response.i) throw new Error('MKKEY_AUTH_FAILED');
	return { type: 'signedIn', id: response.id, token: response.i };
}
