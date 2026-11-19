/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { jest } from '@jest/globals';
for (const name of ['QueueService', 'CreateSystemUserService', 'IdService']) {
	jest.unstable_mockModule(`@/core/${name}.js`, () => ({ [name]: class {} }));
}
jest.unstable_mockModule('@/core/activitypub/ApRendererService.js', () => ({ ApRendererService: class {} }));
const { RelayService } = await import('@/core/RelayService.js');

test('direct recipients are excluded from normal relay delivery while other relays keep receiving the activity', async () => {
	const queue = { deliver: jest.fn() };
	const renderer = { attachLdSignature: jest.fn(async (value: unknown) => value) };
	const service = new RelayService({} as never, {} as never, {} as never, queue as never, {} as never, renderer as never);
	jest.spyOn(service, 'getAcceptedRelays').mockResolvedValue([{ inbox: 'https://mkkey.net/inbox' }, { inbox: 'https://other.test/inbox' }] as never);
	await service.deliverToRelays({ id: 'local-author', host: null }, { type: 'Create' }, new Set(['https://mkkey.net/inbox']));
	const targets = queue.deliver.mock.calls.map(call => call[2]);
	expect(targets).toEqual(['https://other.test/inbox']);
	queue.deliver.mockClear(); renderer.attachLdSignature.mockClear();
	await service.deliverToRelays({ id: 'local-author', host: null }, { type: 'Create' }, new Set(['https://mkkey.net/inbox', 'https://other.test/inbox']));
	expect(queue.deliver).not.toHaveBeenCalled();
	expect(renderer.attachLdSignature).not.toHaveBeenCalled();
});
