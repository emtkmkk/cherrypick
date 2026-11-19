/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { RawData } from 'ws';

type StreamMessage = { type: string; body?: any };
type TestSocket = {
	on(event: string, listener: (...args: any[]) => void): unknown;
	send(data: string): unknown;
	close(): unknown;
};

/** Observe only after the server has acknowledged the subscription. */
export function observeStreamEvent(
	socket: TestSocket,
	subscriptions: StreamMessage[],
	readyId: string,
	trigger: () => Promise<unknown>,
	matches: (message: StreamMessage) => boolean,
	observationMs = 3000,
): Promise<boolean> {
	return new Promise((resolve, reject) => {
		let settled = false;
		let ready = false;
		let triggered = false;
		let matched = false;
		let timer: NodeJS.Timeout;
		const finish = (error?: Error, result = false) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			socket.close();
			if (error) reject(error);
			else resolve(result);
		};
		timer = setTimeout(() => finish(new Error('Streaming subscription was not acknowledged')), 10_000);
		socket.on('error', (error: Error) => finish(error));
		socket.on('close', () => finish(new Error('Streaming connection closed before observation finished')));
		socket.on('open', () => {
			for (const message of subscriptions) socket.send(JSON.stringify(message));
		});
		socket.on('message', (data: RawData) => {
			if (settled) return;
			try {
				const message = JSON.parse(data.toString()) as StreamMessage;
				if (!ready && message.type === 'connected' && message.body?.id === readyId) {
					ready = true;
					clearTimeout(timer);
					timer = setTimeout(() => finish(new Error('Streaming test trigger timed out')), 10_000);
					Promise.resolve().then(trigger).then(() => {
						if (settled) return;
						triggered = true;
						clearTimeout(timer);
						if (matched) finish(undefined, true);
						else timer = setTimeout(() => finish(), observationMs);
					}).catch(error => finish(error));
				} else if (ready && matches(message)) {
					matched = true;
					if (triggered) finish(undefined, true);
				}
			} catch (error) {
				finish(error instanceof Error ? error : new Error(String(error)));
			}
		});
	});
}
