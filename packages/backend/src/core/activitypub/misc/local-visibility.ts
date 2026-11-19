/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** Restores the source's local scope only for trusted bubble peers; wire recipients remain authoritative elsewhere. */
export function localVisibility(host: string, visibility: 'public' | 'home' | 'followers' | 'specified', original: unknown, bubbleHosts: readonly string[] | undefined) {
	if (visibility !== 'specified' && bubbleHosts?.includes(host) && (original === 'public' || original === 'home')) {
		return { visibility: original, localAndFollowers: visibility === 'followers' };
	}
	return { visibility, localAndFollowers: false };
}
