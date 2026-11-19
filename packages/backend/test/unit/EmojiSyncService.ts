/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { jest } from '@jest/globals';
import { IsNull } from 'typeorm';

// No database, Redis, or network is needed for reconciliation tests.
jest.unstable_mockModule('@/di-symbols.js', () => ({ DI: { emojisRepository: 'emojisRepository' } }));
jest.unstable_mockModule('@/logger.js', () => ({ default: class {
	info() {} error() {}
} }));
for (const name of ['HttpRequestService', 'CustomEmojiService', 'GlobalEventService']) {
	jest.unstable_mockModule(`@/core/${name}.js`, () => ({ [name]: class {} }));
}
jest.unstable_mockModule('@/core/entities/EmojiEntityService.js', () => ({ EmojiEntityService: class {} }));

const { EmojiSyncService } = await import('@/core/EmojiSyncService.js');

const remote = (name: string, fields: Record<string, unknown> = {}) => ({
	id: name, name, url: `https://mkkey.net/${name}.png`, aliases: [], ...fields,
});

function setup(emojis: unknown, existing: ReturnType<typeof remote>[] = []) {
	const repository = {
		find: jest.fn(async () => existing.map(e => ({
			...e, host: null, originalUrl: e.url, publicUrl: e.url,
			category: null, license: null, isSensitive: false,
		}))),
		insertOne: jest.fn(async (_data: unknown) => {}),
		update: jest.fn(async (_id: string, _data: unknown) => {}),
	};
	const http = { getJson: jest.fn(async () => ({ emojis })) };
	const custom = {
		deleteBulk: jest.fn(async (_ids: string[]) => {}),
		localEmojisCache: { refresh: jest.fn(async () => {}) },
	};
	const entity = { packDetailedMany: jest.fn(async (ids: string[]) => ids.map(id => ({ id }))) };
	const events = { publishBroadcastStream: jest.fn() };
	const service = new EmojiSyncService(repository as never, http as never, custom as never, entity as never, events as never);
	return { service, repository, http, custom, events };
}

describe('mkkey emoji sync', () => {
	test('imports public emojis without a motif, including omitted API defaults', async () => {
		const { service, repository, events, custom } = setup([
			remote('explicit', { usageVisibility: 'public', motifUserId: null }),
			remote('omitted'),
			remote('limited', { usageVisibility: 'limited' }),
			remote('user', { usageVisibility: 'user' }),
			remote('private', { usageVisibility: 'private' }),
			remote('motif', { motifUserId: 'user1', motifUserMode: 'any' }),
			remote('foreign', { host: 'example.com' }),
		]);
		await service.syncEmojis();
		expect(repository.insertOne.mock.calls.map(([e]) => (e as { name: string }).name)).toEqual(['explicit', 'omitted']);
		expect(repository.insertOne).toHaveBeenCalledWith(expect.objectContaining({ category: null, license: null }));
		expect(custom.localEmojisCache.refresh).toHaveBeenCalledTimes(1);
		expect(events.publishBroadcastStream).toHaveBeenCalledTimes(2);
	});

	test('deletes existing ineligible or removed emojis and keeps eligible ones', async () => {
		const { service, custom, repository } = setup([
			remote('keep'), remote('limited', { usageVisibility: 'limited' }),
			remote('motif', { motifUserId: 'user1', motifUserMode: 'any' }),
		], ['keep', 'limited', 'motif', 'gone'].map(name => remote(name)));
		await service.syncEmojis();
		expect(custom.deleteBulk).toHaveBeenCalledWith(['limited', 'motif', 'gone']);
		expect(repository.find).toHaveBeenCalledWith({ where: { host: IsNull() } });
		expect(repository.update).not.toHaveBeenCalled();
	});

	test('removes all local emojis if a valid snapshot has no eligible entries', async () => {
		const { service, custom } = setup([remote('limited', { usageVisibility: 'limited' })], [remote('limited')]);
		await service.syncEmojis();
		expect(custom.deleteBulk).toHaveBeenCalledWith(['limited']);
	});

	test.each([undefined, {}, [null], [remote('broken', { aliases: null })]])('does not write for malformed response %p', async emojis => {
		const { service, repository, custom } = setup(emojis, [remote('keep')]);
		await service.syncEmojis();
		expect(repository.find).not.toHaveBeenCalled();
		expect(repository.insertOne).not.toHaveBeenCalled();
		expect(repository.update).not.toHaveBeenCalled();
		expect(custom.deleteBulk).not.toHaveBeenCalled();
	});

	test('does not delete when fetching fails', async () => {
		const { service, http, custom } = setup([], [remote('keep')]);
		http.getJson.mockRejectedValue(new Error('unavailable'));
		await service.syncEmojis();
		expect(custom.deleteBulk).not.toHaveBeenCalled();
	});

	test('updates eligible emojis and broadcasts the update', async () => {
		const { service, repository, events } = setup([remote('keep', { category: 'new' })], [remote('keep')]);
		await service.syncEmojis();
		expect(repository.update).toHaveBeenCalledWith('keep', expect.objectContaining({ category: 'new' }));
		expect(events.publishBroadcastStream).toHaveBeenCalledWith('emojiUpdated', { emojis: [{ id: 'keep' }] });
	});
});
