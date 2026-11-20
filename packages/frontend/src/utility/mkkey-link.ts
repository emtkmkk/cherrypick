/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ref } from 'vue';
import { $i } from '@/i.js';
import { runMkkeyAuth, mkkeySsoRequest, mkkeyAuthError } from '@/utility/mkkey-sso.js';
import * as os from '@/os.js';

export const mkkeyLink = ref<{ linked: boolean; username: string | null; } | null>(null);
export const mkkeyLinkBusy = ref(false);

export async function loadMkkeyLink() {
	if (!$i) return;
	mkkeyLink.value = await mkkeySsoRequest('status', { i: $i.token });
}

export async function linkMkkeyAccount() {
	if (mkkeyLinkBusy.value || !$i || mkkeyLink.value?.linked) return;
	mkkeyLinkBusy.value = true;
	try {
		const auth = await os.authenticateDialog();
		if (auth.canceled) return;
		const oauthToken = await runMkkeyAuth('link', { i: $i.token, password: auth.result.password, token: auth.result.token ?? undefined });
		mkkeyLink.value = await mkkeySsoRequest('link', { i: $i.token, oauthToken });
		await os.alert({ type: 'success', text: 'もこきーアカウントと連携しました。次回からもこきーでログインできます。' });
	} catch (error) {
		await os.alert({ type: 'error', text: mkkeyAuthError(error) });
	} finally {
		mkkeyLinkBusy.value = false;
	}
}
