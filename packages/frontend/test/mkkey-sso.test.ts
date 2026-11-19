/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { runMkkeyAuth } from '@/scripts/mkkey-sso.js';

vi.mock('@@/js/config.js', () => ({ apiUrl: 'https://cp.example/api' }));

const session = '12345678-1234-4234-8234-123456789abc';
const url = `https://mkkey.net/miauth/${session}`;
const data = { source: 'mkkey-sso', mode: 'signin', session, oauthToken: 'opaque-proof' };

function setup() {
	const popup = { location: { href: 'about:blank' }, closed: false, close: vi.fn() };
	const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
	const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ url, session }) } as Response);
	const message = (overrides: object = {}) => window.dispatchEvent(new MessageEvent('message', {
		origin: 'https://cp.example', source: popup as unknown as Window, data, ...overrides,
	}));
	return { popup, open, fetch, message };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('mkkey popup authentication', () => {
	test('opens before requesting authorization, navigates, and cleans up after a valid message', async () => {
		const s = setup();
		const result = runMkkeyAuth('signin');
		expect(s.open.mock.invocationCallOrder[0]).toBeLessThan(s.fetch.mock.invocationCallOrder[0]);
		await vi.advanceTimersByTimeAsync(0);
		expect(s.popup.location.href).toBe(url);
		expect(s.fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'same-origin' });
		s.message();
		await expect(result).resolves.toBe('opaque-proof');
		expect(s.popup.close).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});

	test('ignores messages from another origin, window, purpose or session', async () => {
		const s = setup();
		let finished = false;
		const result = runMkkeyAuth('signin').then(value => { finished = true; return value; });
		await vi.advanceTimersByTimeAsync(0);
		s.message({ origin: 'https://attacker.example' });
		s.message({ source: null });
		s.message({ data: { ...data, mode: 'signup' } });
		s.message({ data: { ...data, session: 'another-session' } });
		await vi.advanceTimersByTimeAsync(0);
		expect(finished).toBe(false);
		s.message();
		await expect(result).resolves.toBe('opaque-proof');
	});

	test('reports blocked popups without starting authentication', async () => {
		const s = setup();
		s.open.mockReturnValue(null);
		await expect(runMkkeyAuth('signin')).rejects.toThrow('POPUP_BLOCKED');
		expect(s.fetch).not.toHaveBeenCalled();
	});

	test('cleans up when the user closes the popup', async () => {
		const s = setup();
		const result = expect(runMkkeyAuth('signin')).rejects.toThrow('MKKEY_AUTH_CANCELLED');
		await vi.advanceTimersByTimeAsync(0);
		s.popup.closed = true;
		await vi.advanceTimersByTimeAsync(1000);
		await result;
		expect(vi.getTimerCount()).toBe(0);
	});

	test('times out and removes timers', async () => {
		const s = setup();
		const result = expect(runMkkeyAuth('signin')).rejects.toThrow('MKKEY_AUTH_TIMEOUT');
		await vi.advanceTimersByTimeAsync(300_000);
		await result;
		expect(s.popup.close).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});

	test('closes the popup on request failure or an unexpected provider URL', async () => {
		const s = setup();
		s.fetch.mockRejectedValueOnce(new Error('network'));
		await expect(runMkkeyAuth('signin')).rejects.toThrow('network');
		s.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ url: 'https://attacker.example', session }) } as Response);
		await expect(runMkkeyAuth('signin')).rejects.toThrow('MKKEY_AUTH_FAILED');
		expect(s.popup.close).toHaveBeenCalledTimes(2);
		expect(vi.getTimerCount()).toBe(0);
	});
});
