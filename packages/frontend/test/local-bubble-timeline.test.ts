/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/vue';
import Timeline from '@/components/MkStreamingNotesTimeline.vue';
import { useStream } from '@/stream.js';
import { store } from '@/store.js';

const state = vi.hoisted(() => ({ paginators: [] as { endpoint: string; params: Record<string, unknown> }[] }));
vi.mock('@/i18n.js', () => ({ i18n: { ts: { noNotes: 'no notes' } } }));
vi.mock('@/i.js', () => ({ $i: null }));
vi.mock('@/instance.js', () => ({ instance: { notesPerOneAd: 0 } }));
vi.mock('@/store.js', () => ({ store: { s: { realtimeMode: true } } }));
vi.mock('@/preferences.js', () => ({ prefer: { s: { showGapBetweenNotesInTimeline: true } } }));
vi.mock('@/stream.js', () => ({ useStream: vi.fn() }));
vi.mock('@/utility/sound.js', () => ({ playMisskeySfx: vi.fn() }));
vi.mock('@/utility/haptic.js', () => ({ haptic: vi.fn(), hapticConfirm: vi.fn() }));
vi.mock('@/utility/is-friendly.js', () => ({ isFriendly: () => ({ value: false }) }));
vi.mock('@/utility/scroll-to-visibility.js', () => ({ scrollToVisibility: () => ({ showEl: { value: false } }) }));
vi.mock('@/events.js', () => ({ globalEvents: { on: vi.fn(), off: vi.fn(), emit: vi.fn() }, useGlobalEvent: vi.fn() }));
vi.mock('@@/js/use-interval.js', () => ({ useInterval: vi.fn() }));
vi.mock('@@/js/use-document-visibility.js', async () => { const { ref } = await import('vue'); return { useDocumentVisibility: () => ref('visible') }; });
vi.mock('@/components/MkNote.vue', () => ({ default: { template: '<div/>' } }));
vi.mock('@/components/MkNoteMediaGrid.vue', () => ({ default: { template: '<div/>' } }));
vi.mock('@/utility/paginator.js', async () => {
	const { ref } = await import('vue');
	return { Paginator: class {
		fetching = ref(false);
		error = ref(null);
		items = ref([]);
		queuedAheadItemsCount = ref(0);
		init = vi.fn();
		dispose = vi.fn();
		constructor(endpoint: string, options: { computedParams: { value: Record<string, unknown> } }) {
			state.paginators.push({ endpoint, params: options.computedParams.value });
		}
	} };
});
const dispose = vi.fn();
const useChannel = vi.fn(() => ({ on: vi.fn(), dispose }));
beforeEach(() => {
	vi.clearAllMocks();
	state.paginators = [];
	store.s.realtimeMode = true;
	vi.mocked(useStream).mockReturnValue({ useChannel } as never);
});
afterEach(cleanup);
test.each(['local', 'bubble'] as const)('%s uses local pagination and streaming with matching reply filters', src => {
	const view = render(Timeline, { props: { src, withRenotes: false, onlyFiles: true, onlyCats: true, withReplies: true } });
	expect(state.paginators[0]).toEqual({ endpoint: 'notes/local-timeline', params: { withRenotes: false, withFiles: true, withCats: true, withReplies: true } });
	expect(useChannel).toHaveBeenCalledWith('localTimeline', state.paginators[0].params);
	expect(useChannel).not.toHaveBeenCalledWith('bubbleTimeline', expect.anything());
	view.unmount();
	expect(dispose).toHaveBeenCalled();
});
test('polling mode retains local pagination', () => {
	store.s.realtimeMode = false;
	render(Timeline, { props: { src: 'local' } });
	expect(state.paginators[0].endpoint).toBe('notes/local-timeline');
	expect(useChannel).not.toHaveBeenCalled();
});
test('home pagination and streaming retain their own endpoint', () => {
	render(Timeline, { props: { src: 'home' } });
	expect(state.paginators[0].endpoint).toBe('notes/timeline');
	expect(useChannel).toHaveBeenCalledWith('homeTimeline', expect.anything());
});
