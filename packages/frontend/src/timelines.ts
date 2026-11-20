/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { $i } from '@/i.js';
import { instance } from '@/instance.js';
import { prefer } from '@/preferences.js';

export const basicTimelineTypes = [
	'home',
	'local',
	'social',
	'global',
	'media',
	'bubble',
] as const;

export type BasicTimelineType = typeof basicTimelineTypes[number];
export const visibleBasicTimelineTypes = basicTimelineTypes.filter(timeline => timeline !== 'bubble');

export function normalizeTimelineSource<T extends string>(timeline: T): T | 'local' {
	return timeline === 'bubble' ? 'local' : timeline;
}

export function isBasicTimeline(timeline: string): timeline is BasicTimelineType {
	return basicTimelineTypes.includes(timeline as BasicTimelineType);
}

export function basicTimelineIconClass(timeline: BasicTimelineType): string {
	switch (timeline) {
		case 'home':
			return 'ti ti-home';
		case 'local':
		case 'bubble':
			return 'ti ti-planet';
		case 'social':
			return 'ti ti-universe';
		case 'global':
			return 'ti ti-world';
		case 'media':
			return 'ti ti-photo';
	}
}

export function isAvailableBasicTimeline(timeline: BasicTimelineType | undefined | null): boolean {
	switch (timeline) {
		case 'home':
			return $i != null && prefer.s.enableHomeTimeline;
		case 'local':
		case 'bubble':
			return ($i == null && instance.policies.ltlAvailable) || ($i != null && $i.policies.ltlAvailable && prefer.s.enableLocalTimeline);
		case 'social':
			return $i != null && $i.policies.ltlAvailable && prefer.s.enableSocialTimeline;
		case 'global':
			return ($i == null && instance.policies.gtlAvailable) || ($i != null && $i.policies.gtlAvailable && prefer.s.enableGlobalTimeline);
		case 'media':
			return ($i == null && instance.policies.ltlAvailable) || ($i != null && $i.policies.ltlAvailable && prefer.s.enableMediaTimeline);
		default:
			return false;
	}
}

export function availableBasicTimelines(): BasicTimelineType[] {
	return visibleBasicTimelineTypes.filter(isAvailableBasicTimeline);
}

export function hasWithReplies(timeline: BasicTimelineType | undefined | null): boolean {
	return timeline === 'local' || timeline === 'bubble' || timeline === 'social';
}
