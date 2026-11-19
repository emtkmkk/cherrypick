/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { EventEmitter } from 'node:events';
import { jest } from '@jest/globals';
import { observeStreamEvent } from '../../test-federation/test/stream-event.js';

class Socket extends EventEmitter {
	send = jest.fn();
	close = jest.fn();
	message(type: string, body: unknown) { this.emit('message', Buffer.from(JSON.stringify({ type, body }))); }
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

function setup(trigger = jest.fn(async () => {})) {
	const socket = new Socket();
	const result = observeStreamEvent(socket, [{ type: 'connect', body: { id: 'test', pong: true } }], 'test', trigger,
		message => message.type === 'channel' && message.body?.text === 'expected');
	return { socket, trigger, result };
}

test('does not trigger until the subscription is acknowledged', async () => {
	const t = setup();
	t.socket.emit('open');
	expect(t.socket.send).toHaveBeenCalled();
	expect(t.trigger).not.toHaveBeenCalled();
	t.socket.message('connected', { id: 'wrong-id' });
	await Promise.resolve();
	expect(t.trigger).not.toHaveBeenCalled();
	t.socket.message('connected', { id: 'test' });
	await Promise.resolve();
	t.socket.message('channel', { text: 'expected' });
	await expect(t.result).resolves.toBe(true);
	expect(t.trigger).toHaveBeenCalledTimes(1);
	expect(jest.getTimerCount()).toBe(0);
});

test('waits past the old 500ms deadline for delayed federation delivery', async () => {
	const t = setup();
	t.socket.message('connected', { id: 'test' });
	await jest.advanceTimersByTimeAsync(1200);
	t.socket.message('channel', { text: 'expected' });
	await expect(t.result).resolves.toBe(true);
	expect(jest.getTimerCount()).toBe(0);
});

test('returns false for an absent event after the full observation window', async () => {
	const t = setup();
	t.socket.message('connected', { id: 'test' });
	await jest.advanceTimersByTimeAsync(3000);
	await expect(t.result).resolves.toBe(false);
	expect(t.socket.close).toHaveBeenCalledTimes(1);
});

test('an event arriving before the trigger resolves leaves no later timer', async () => {
	let complete!: () => void;
	const t = setup(jest.fn(() => new Promise<void>(resolve => { complete = resolve; })));
	t.socket.message('connected', { id: 'test' });
	await Promise.resolve();
	t.socket.message('channel', { text: 'expected' });
	complete();
	await expect(t.result).resolves.toBe(true);
	expect(jest.getTimerCount()).toBe(0);
});

test('failure to subscribe rejects instead of passing a negative reception test', async () => {
	const t = setup();
	const check = expect(t.result).rejects.toThrow('not acknowledged');
	await jest.advanceTimersByTimeAsync(10_000);
	await check;
	expect(t.trigger).not.toHaveBeenCalled();
});

test('trigger failures reject and clean up the socket and timer', async () => {
	const t = setup(jest.fn(async () => { throw new Error('post failed'); }));
	t.socket.message('connected', { id: 'test' });
	await expect(t.result).rejects.toThrow('post failed');
	expect(t.socket.close).toHaveBeenCalledTimes(1);
	expect(jest.getTimerCount()).toBe(0);
});
