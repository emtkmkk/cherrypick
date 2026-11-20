/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('@/core/CacheService.js', () => ({ CacheService: class {} }));
jest.unstable_mockModule('@/core/ChannelFollowingService.js', () => ({ ChannelFollowingService: class {} }));
jest.unstable_mockModule('@/models/_.js', () => ({ MiFollowing: class {}, MiUserProfile: class {} }));
const { default: Connection } = await import('@/server/api/stream/Connection.js');

test('acknowledges a channel only after its asynchronous initialization finishes', async () => {
	let initialized!: () => void;
	const channel = { init: jest.fn(() => new Promise<void>(resolve => { initialized = resolve; })) };
	const service = { requireCredential: false, shouldShare: false, create: () => channel };
	const connection = new Connection({ getChannelService: () => service } as never, {} as never, {} as never, {} as never, null, null);
	const send = jest.spyOn(connection, 'sendMessageToWs').mockImplementation(() => {});
	const ready = connection.connectChannel('test-id', {}, 'localTimeline', true);
	expect(send).not.toHaveBeenCalled();
	initialized();
	await ready;
	expect(send).toHaveBeenCalledWith('connected', { id: 'test-id' });
});
