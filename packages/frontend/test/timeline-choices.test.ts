/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeEach, expect, test, vi } from 'vitest';
import { availableBasicTimelines, visibleBasicTimelineTypes, isAvailableBasicTimeline, normalizeTimelineSource, hasWithReplies } from '@/timelines.js';
import { defaultStore } from '@/store.js';
import { instance } from '@/instance.js';

const state = vi.hoisted(() => ({ user: null as null | { policies: { btlAvailable: boolean; ltlAvailable: boolean; gtlAvailable: boolean; }; } }));
vi.mock('@/account.js', () => ({ get $i() { return state.user; } }));
vi.mock('@/instance.js', () => ({ instance: { policies: { btlAvailable: false, ltlAvailable: true, gtlAvailable: true } } }));
vi.mock('@/store.js', () => ({ defaultStore: { state: { enableLocalTimeline: true, enableHomeTimeline: true, enableSocialTimeline: true, enableGlobalTimeline: true, enableBubbleTimeline: false } } }));

beforeEach(() => {
	state.user = null;
	instance.policies.ltlAvailable = true;
	defaultStore.state.enableLocalTimeline = true;
});

test('only offers one local entry and respects guest local permissions', () => {
	expect(visibleBasicTimelineTypes).not.toContain('bubble');
	expect(availableBasicTimelines()).toEqual(['local', 'global']);
	instance.policies.ltlAvailable = false;
	expect(availableBasicTimelines()).toEqual(['global']);
});

test('uses the signed-in local policy and local display setting', () => {
	state.user = { policies: { btlAvailable: false, ltlAvailable: true, gtlAvailable: true } };
	expect(isAvailableBasicTimeline('local')).toBe(true);
	state.user.policies.ltlAvailable = false;
	expect(isAvailableBasicTimeline('local')).toBe(false);
	state.user.policies.ltlAvailable = true;
	defaultStore.state.enableLocalTimeline = false;
	expect(isAvailableBasicTimeline('local')).toBe(false);
});

test('retains legacy bubble choices as local without showing a duplicate option', () => {
	expect(normalizeTimelineSource('bubble')).toBe('local');
	expect(normalizeTimelineSource('home')).toBe('home');
	expect(isAvailableBasicTimeline('bubble')).toBe(isAvailableBasicTimeline('local'));
	expect(availableBasicTimelines()).not.toContain('bubble');
});

test('keeps the local reply toggle available', () => {
	expect(hasWithReplies('local')).toBe(true);
	expect(hasWithReplies('bubble')).toBe(true);
	expect(hasWithReplies('social')).toBe(true);
});
