/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render as renderComponent, screen } from '@testing-library/vue';
import { nextTick } from 'vue';
import Announcements from '@/ui/_common_/announcements.vue';
import { mkkeyLink, linkMkkeyAccount } from '@/utility/mkkey-link.js';

vi.mock('@/i.js', () => ({ $i: { id: 'local-user', unreadAnnouncements: [] } }));
vi.mock('@/i18n.js', () => ({ i18n: { ts: { close: '閉じる' } } }));
vi.mock('@/utility/mkkey-link.js', async () => {
	const { ref } = await import('vue');
	return {
		mkkeyLink: ref(null),
		mkkeyLinkBusy: ref(false),
		loadMkkeyLink: vi.fn(async () => {}),
		linkMkkeyAccount: vi.fn(),
	};
});

function render(component: typeof Announcements) {
	return renderComponent(component, { global: { stubs: { MkA: true } } });
}

beforeEach(() => {
	sessionStorage.clear();
	mkkeyLink.value = null;
	vi.clearAllMocks();
});
afterEach(cleanup);

describe('mkkey link notice', () => {
	test('only shows the notice for a confirmed unlinked account', async () => {
		render(Announcements);
		expect(screen.queryByText('連携する')).toBeNull();
		mkkeyLink.value = { linked: false, username: null };
		await nextTick();
		expect(screen.getByText('もこきーアカウントが未連携です。')).toBeTruthy();
		await fireEvent.click(screen.getByText('連携する'));
		expect(linkMkkeyAccount).toHaveBeenCalledOnce();
		mkkeyLink.value = { linked: true, username: 'linked' };
		await nextTick();
		expect(screen.queryByText('連携する')).toBeNull();
	});

	test('keeps a dismissed notice closed when the UI remounts in the same tab', async () => {
		mkkeyLink.value = { linked: false, username: null };
		const view = render(Announcements);
		await fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
		expect(screen.queryByText('連携する')).toBeNull();
		view.unmount();
		render(Announcements);
		await nextTick();
		expect(screen.queryByText('連携する')).toBeNull();
	});
});
