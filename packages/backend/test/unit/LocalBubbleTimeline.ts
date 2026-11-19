/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { jest } from '@jest/globals';

for (const [path, name] of [
	['core/entities/NoteEntityService', 'NoteEntityService'], ['core/RoleService', 'RoleService'],
	['core/IdService', 'IdService'], ['core/FanoutTimelineEndpointService', 'FanoutTimelineEndpointService'],
	['core/QueryService', 'QueryService'], ['core/CacheService', 'CacheService'], ['core/MetaService', 'MetaService'],
]) {
	jest.unstable_mockModule(`@/${path}.js`, () => ({ [name]: class {} }));
}
jest.unstable_mockModule('@/core/chart/charts/active-users.js', () => ({ default: class {} }));
jest.unstable_mockModule('@/models/User.js', () => ({ MiLocalUser: class {} }));
jest.unstable_mockModule('@/server/api/endpoint-base.js', () => ({ Endpoint: class {
	public exec: (...args: any[]) => Promise<unknown>;
	constructor(_meta: unknown, _params: unknown, exec: (...args: any[]) => Promise<unknown>) { this.exec = exec; }
} }));
jest.unstable_mockModule('@/server/api/stream/channel.js', () => ({ default: class {
	public user: any;
	public following: any;
	public subscriber: any;
	constructor(_id: string, public connection: any) {
		this.user = connection.user; this.following = connection.following; this.subscriber = connection.subscriber;
	}
	isNoteMutedOrBlocked() { return false; }
	send(type: string, body: unknown) { this.connection.send(type, body); }
} }));

const { default: LocalTimeline } = await import('@/server/api/endpoints/notes/local-timeline.js');
const { LocalTimelineChannelService } = await import('@/server/api/stream/channels/local-timeline.js');

function setupEndpoint(hosts = ['mkkey.net']) {
	const clauses: string[] = [];
	const parameters: Record<string, unknown> = {};
	const query: any = {};
	for (const method of ['where', 'andWhere', 'orWhere']) {
		query[method] = (condition: any, params: object = {}) => {
			if (typeof condition === 'string') clauses.push(condition);
			else condition.whereFactory(query);
			Object.assign(parameters, params); return query;
		};
	}
	for (const method of ['innerJoinAndSelect', 'leftJoinAndSelect', 'limit']) query[method] = () => query;
	query.getMany = jest.fn(async () => []);
	const fanout = { timeline: jest.fn(async () => []) };
	const service = new LocalTimeline(
		{ bubbleInstances: hosts, enableFanoutTimeline: true } as never,
		{ createQueryBuilder: () => query } as never,
		{ packMany: jest.fn(async (notes: unknown) => notes) } as never,
		{ getUserPolicies: async () => ({ ltlAvailable: true, canPublicNote: true }) } as never,
		{ read() {} } as never, { gen: () => 'id' } as never, fanout as never,
		{ makePaginationQuery: () => query, generateVisibilityQuery() {}, generateMutedUserQuery() {}, generateBlockedUserQuery() {}, generateMutedUserRenotesQueryForNotes() {} } as never,
		{ userFollowingsCache: { fetch: async () => ({ 'followed-author': { withReplies: true } }) } } as never,
	);
	const params = { withFiles: false, withReplies: false, withRenotes: true, withCats: false, limit: 10 };
	return { service, clauses, parameters, query, fanout, params };
}

async function setupChannel(withReplies: boolean, user: { id: string } | null = { id: 'reader' }) {
	let receive!: (note: any) => Promise<void>;
	const connection = {
		user, following: {}, cacheNote: jest.fn(), send: jest.fn(),
		subscriber: { on: (_event: string, callback: typeof receive) => { receive = callback; }, off: jest.fn() },
	};
	const service = new LocalTimelineChannelService(
		{ fetch: async () => ({ bubbleInstances: ['mkkey.net'] }) } as never,
		{ getUserPolicies: async () => ({ ltlAvailable: true, canPublicNote: true }) } as never, {} as never,
	);
	const channel = service.create('test', connection as never);
	await channel.init({ withReplies });
	return { receive, connection, channel };
}

function note(host: string | null, replyAuthor?: string, replyHost: string | null = 'mkkey.net') {
	return { id: 'note', userId: 'author', user: { id: 'author', host }, visibility: 'public', fileIds: [], channelId: null, renoteId: null,
		reply: replyAuthor ? { userId: replyAuthor, user: { host: replyHost } } : null };
}

describe('local timeline includes the configured bubble and retains reply filtering', () => {
	test('bypasses the local-only Redis lists and queries local plus bubble authors', async () => {
		const t = setupEndpoint();
		await t.service.exec(t.params, null, null, null);
		expect(t.fanout.timeline).not.toHaveBeenCalled();
		expect(t.query.getMany).toHaveBeenCalled();
		expect(t.parameters.bubbleHosts).toEqual(['mkkey.net']);
		expect(t.clauses).toContain('(note.userHost IS NULL OR note.userHost = ANY(:bubbleHosts))');
		expect(t.clauses).toContain('note.localAndFollowers = false');
		expect(t.clauses).toContain('note.replyUserId = note.userId');
	});

	test('reply-on removes the reply exclusion; reply-off retains reader and following exceptions', async () => {
		const enabled = setupEndpoint();
		await enabled.service.exec({ ...enabled.params, withReplies: true }, { id: 'reader' } as never, null, null);
		expect(enabled.clauses).not.toContain('note.replyUserId = note.userId');
		const disabled = setupEndpoint();
		await disabled.service.exec(disabled.params, { id: 'reader' } as never, null, null);
		expect(disabled.parameters.localTimelineMeId).toBe('reader');
		expect(disabled.parameters.withReplyUserIds).toEqual(['followed-author']);
	});

	test('preserves cached local timelines when no bubble hosts are configured', async () => {
		const t = setupEndpoint([]);
		await t.service.exec(t.params, null, null, null);
		expect(t.fanout.timeline).toHaveBeenCalled();
		expect(t.query.getMany).not.toHaveBeenCalled();
	});

	test('the database path still filters pure renotes', async () => {
		const t = setupEndpoint();
		await t.service.exec({ ...t.params, withRenotes: false }, null, null, null);
		expect(t.clauses).toContain('(note.renoteId IS NULL OR note.text IS NOT NULL OR note.fileIds != \'{}\')');
	});

	test('streaming accepts local and bubble authors but excludes other hosts and private notes', async () => {
		const t = await setupChannel(true);
		await t.receive(note(null)); await t.receive(note('mkkey.net'));
		await t.receive(note('other.example'));
		await t.receive({ ...note('mkkey.net'), visibility: 'home' });
		await t.receive({ ...note('mkkey.net'), channelId: 'private-channel' });
		expect(t.connection.send).toHaveBeenCalledTimes(2);
	});

	test.each([null, { id: 'reader' }])('streaming reply-off hides unrelated replies for reader %j', async user => {
		const t = await setupChannel(false, user);
		await t.receive(note('mkkey.net', 'other-user'));
		expect(t.connection.send).not.toHaveBeenCalled();
		await t.receive(note('mkkey.net', 'author'));
		expect(t.connection.send).toHaveBeenCalledTimes(1);
	});

	test('streaming reply-on includes bubble replies but not replies outside the bubble', async () => {
		const t = await setupChannel(true);
		await t.receive(note('mkkey.net', 'other-user'));
		await t.receive(note('mkkey.net', 'other-user', 'other.example'));
		expect(t.connection.send).toHaveBeenCalledTimes(1);
	});

	test('guest streaming does not expose local-and-followers posts', async () => {
		const t = await setupChannel(true, null);
		await t.receive({ ...note('mkkey.net'), localAndFollowers: true });
		expect(t.connection.send).not.toHaveBeenCalled();
	});
});
