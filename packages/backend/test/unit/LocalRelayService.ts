/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { jest } from '@jest/globals';
jest.unstable_mockModule('@/core/RelayService.js', () => ({ RelayService: class {} }));
jest.unstable_mockModule('@/core/QueueService.js', () => ({ QueueService: class {} }));
jest.unstable_mockModule('@/core/activitypub/ApRendererService.js', () => ({ ApRendererService: class {} }));
jest.unstable_mockModule('@/core/entities/UserEntityService.js', () => ({ UserEntityService: class {} }));
const { LocalRelayService } = await import('@/core/LocalRelayService.js');
const { ApDeliverManagerService } = await import('@/core/activitypub/ApDeliverManagerService.js');

function setup() {
	const actor = { id: 'remote', uri: 'https://mkkey.net/users/relay', host: 'mkkey.net', inbox: 'https://mkkey.net/users/relay/inbox', sharedInbox: 'https://mkkey.net/inbox', isSuspended: false, isDeleted: false };
	let row: { userId: string; followId: string; } | null = null;
	const repository = {
		upsert: jest.fn(async (value: NonNullable<typeof row>) => { row = value; }),
		delete: jest.fn(async (value: NonNullable<typeof row>) => { if (row?.userId === value.userId && row.followId === value.followId) row = null; }),
		find: jest.fn(async () => row ? [{ ...row, user: actor }] : []),
	};
	const config = { localRelayHosts: ['mkkey.net'] };
	const relayActor = { id: 'local-relay', host: null };
	const queue = { deliver: jest.fn(async (..._args: unknown[]) => {}) };
	const renderer = { renderAccept: (object: unknown) => ({ type: 'Accept', object }), addContext: (value: unknown) => value };
	const service = new LocalRelayService(config as never, { getRepository: () => repository } as never, { getRelayActor: async () => relayActor } as never, queue as never, renderer as never);
	const activity = { type: 'Follow', id: 'https://mkkey.net/activities/follow-relay/a', actor: actor.uri, object: 'https://www.w3.org/ns/activitystreams#Public' };
	const note = { userHost: null, visibility: 'public', localOnly: false };
	return { actor, repository, config, relayActor, queue, service, activity, note };
}

describe('local relay subscriptions', () => {
	test('a normal follower and relay subscription sharing an inbox are delivered once', async () => {
		const inbox = 'https://mkkey.net/inbox';
		const queue = { deliverMany: jest.fn(async (..._args: unknown[]) => {}) };
		const service = new ApDeliverManagerService({ find: async () => [{ followerSharedInbox: inbox, followerInbox: 'https://mkkey.net/users/u/inbox' }] } as never, {} as never, queue as never);
		const dm = service.createDeliverManager({ id: 'author', host: null }, { type: 'Create' } as never);
		dm.addFollowersRecipe();
		dm.addInboxes(new Map([[inbox, true]]));
		await dm.execute();
		expect(queue.deliverMany).toHaveBeenCalledWith({ id: 'author' }, { type: 'Create' }, new Map([[inbox, true]]));
	});
	test('a permitted Follow(Public) is persisted and receives an Accept containing the original request', async () => {
		const s = setup();
		expect(await s.service.follow(s.actor as never, s.activity as never)).toBe('ok: local relay subscribed');
		expect(s.queue.deliver).toHaveBeenCalledWith(s.relayActor, { type: 'Accept', object: s.activity }, s.actor.inbox, false);
		expect([...await s.service.getInboxes(s.note as never)]).toEqual([[s.actor.sharedInbox, true]]);
	});

	test('ordinary follows are left to the normal follower handling', async () => {
		const s = setup();
		expect(await s.service.follow(s.actor as never, { ...s.activity, object: 'https://cp.mkkey.net/users/local' } as never)).toBeNull();
		expect(s.repository.upsert).not.toHaveBeenCalled();
	});

	test('unpermitted hosts, cross-host inboxes, and actor or request ID impersonation cannot subscribe', async () => {
		for (const mutate of [
			(s: ReturnType<typeof setup>) => { s.config.localRelayHosts = []; },
			(s: ReturnType<typeof setup>) => { s.config.localRelayHosts = 'mkkey.net' as unknown as string[]; },
			(s: ReturnType<typeof setup>) => { s.actor.sharedInbox = 'https://attacker.test/inbox'; },
			(s: ReturnType<typeof setup>) => { s.actor.inbox = 'https://attacker.test/inbox'; },
			(s: ReturnType<typeof setup>) => { s.activity.actor = 'https://attacker.test/users/x'; },
			(s: ReturnType<typeof setup>) => { s.activity.id = 'https://attacker.test/follow'; },
		]) {
			const s = setup(); mutate(s);
			expect(await s.service.follow(s.actor as never, s.activity as never)).toMatch(/^skip:/);
			expect(s.repository.upsert).not.toHaveBeenCalled();
		}
	});

	test('retries are idempotent and an old Undo does not remove a newer subscription', async () => {
		const s = setup();
		await s.service.follow(s.actor as never, s.activity as never);
		await s.service.follow(s.actor as never, s.activity as never);
		const next = { ...s.activity, id: s.activity.id + 'new' };
		await s.service.follow(s.actor as never, next as never);
		await s.service.follow(s.actor as never, s.activity as never, true);
		expect((await s.service.getInboxes(s.note as never)).size).toBe(1);
		await s.service.follow(s.actor as never, next as never, true);
		expect((await s.service.getInboxes(s.note as never)).size).toBe(0);
	});

	test('public/home are delivered, while private, non-federated and received remote posts never loop back', async () => {
		const s = setup();
		await s.service.follow(s.actor as never, s.activity as never);
		for (const visibility of ['public', 'home']) expect((await s.service.getInboxes({ ...s.note, visibility } as never)).size).toBe(1);
		for (const visibility of ['followers', 'specified', 'hidden']) expect((await s.service.getInboxes({ ...s.note, visibility } as never)).size).toBe(0);
		expect((await s.service.getInboxes({ ...s.note, localOnly: true } as never)).size).toBe(0);
		expect((await s.service.getInboxes({ ...s.note, userHost: 'mkkey.net' } as never)).size).toBe(0);
		s.config.localRelayHosts = [];
		expect((await s.service.getInboxes(s.note as never)).size).toBe(0);
	});

	test('protected bubble references only return to their origin and never to unrelated hosts or private channels', async () => {
		const s = setup();
		await s.service.follow(s.actor as never, s.activity as never);
		const reference = { ...s.note, userHost: 'mkkey.net', localAndFollowers: true };
		expect((await s.service.getReferenceInboxes(s.note as never, reference as never)).size).toBe(1);
		for (const override of [{ userHost: 'other.test' }, { visibility: 'followers' }, { visibility: 'specified' }, { localOnly: true }]) {
			expect((await s.service.getReferenceInboxes(s.note as never, { ...reference, ...override } as never)).size).toBe(0);
		}
	});
});
