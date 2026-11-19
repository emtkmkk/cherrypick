/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/vue';
import MkTimeline from '@/components/MkTimeline.vue';
import { useStream } from '@/stream.js';
import { defaultStore } from '@/store.js';

vi.mock('@/account.js', () => ({ $i: null }));
vi.mock('@/instance.js', () => ({ instance: { notesPerOneAd: 0 } }));
vi.mock('@/store.js', () => ({ defaultStore: { state: { disableStreamingTimeline: false, showGapBetweenNotesInTimeline: true } } }));
vi.mock('@/stream.js', () => ({ useStream: vi.fn() }));
vi.mock('@/scripts/sound.js', () => ({ playMisskeySfx: vi.fn() }));
vi.mock('@/scripts/vibrate.js', () => ({ vibrate: vi.fn() }));
vi.mock('@/events.js', () => ({ globalEvents: { on: vi.fn() } }));
vi.mock('@/components/MkPullToRefresh.vue', () => ({ default: { template: '<div><slot/></div>' } }));
vi.mock('@/components/MkNotes.vue', () => ({ default: {
	props: ['pagination', 'noGap'], template: '<div data-testid="pagination">{{ JSON.stringify(pagination) }}</div>',
} }));

const dispose = vi.fn();
const useChannel = vi.fn(() => ({ on: vi.fn(), dispose }));
beforeEach(() => {
	vi.clearAllMocks();
	defaultStore.state.disableStreamingTimeline = false;
	vi.mocked(useStream).mockReturnValue({ useChannel } as never);
});
afterEach(cleanup);

describe('local timeline uses the bubble feed', () => {
	test.each(['local', 'bubble'] as const)('%s uses matching local pagination and streaming with filters', src => {
		const view = render(MkTimeline, { props: { src, withRenotes: false, onlyFiles: true, onlyCats: true, withReplies: false } });
		const pagination = JSON.parse(screen.getByTestId('pagination').textContent!);
		expect(pagination.endpoint).toBe('notes/local-timeline');
		expect(pagination.params).toEqual({ withRenotes: false, withFiles: true, withCats: true, withReplies: false });
		expect(useChannel).toHaveBeenCalledWith('localTimeline', pagination.params);
		expect(useChannel).not.toHaveBeenCalledWith('bubbleTimeline', expect.anything());
		view.unmount();
		expect(dispose).toHaveBeenCalled();
	});

	test('still uses local pagination when streaming is disabled', () => {
		defaultStore.state.disableStreamingTimeline = true;
		render(MkTimeline, { props: { src: 'local' } });
		expect(JSON.parse(screen.getByTestId('pagination').textContent!).endpoint).toBe('notes/local-timeline');
		expect(useChannel).not.toHaveBeenCalled();
	});

	test('passes the enabled reply filter to both pagination and streaming', () => {
		render(MkTimeline, { props: { src: 'local', withReplies: true } });
		expect(JSON.parse(screen.getByTestId('pagination').textContent!).params.withReplies).toBe(true);
		expect(useChannel).toHaveBeenCalledWith('localTimeline', expect.objectContaining({ withReplies: true }));
	});

	test('keeps the home feed and its streaming channel unchanged', () => {
		render(MkTimeline, { props: { src: 'home' } });
		expect(JSON.parse(screen.getByTestId('pagination').textContent!).endpoint).toBe('notes/timeline');
		expect(useChannel).toHaveBeenCalledWith('homeTimeline', expect.anything());
	});
});
