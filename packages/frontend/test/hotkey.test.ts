/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeHotkey } from '@/utility/hotkey.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
	document.body.replaceChildren();
	vi.clearAllTimers();
	vi.useRealTimers();
});

function sendKey(target: HTMLElement, callback: () => void, ignoreElements?: string[]) {
	const listener = makeHotkey({ n: callback }, ignoreElements);
	document.addEventListener('keydown', listener);
	try {
		target.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
	} finally {
		document.removeEventListener('keydown', listener);
	}
}

describe('global hotkeys while editing', () => {
	test('does not treat a textarea key as a shortcut when focus moves during keydown', () => {
		const input = document.createElement('textarea');
		document.body.append(input);
		input.focus();
		input.addEventListener('keydown', () => input.blur());
		const callback = vi.fn();
		sendKey(input, callback);
		expect(document.activeElement).toBe(document.body);
		expect(callback).not.toHaveBeenCalled();
	});

	test('ignores an input event even when the input is no longer active', () => {
		const input = document.createElement('input');
		document.body.append(input);
		const callback = vi.fn();
		sendKey(input, callback);
		expect(callback).not.toHaveBeenCalled();
	});

	test('still handles shortcuts outside an editor', () => {
		const callback = vi.fn();
		sendKey(document.body, callback);
		expect(callback).toHaveBeenCalledOnce();
	});

	test('preserves the explicit opt-in to shortcuts within inputs', () => {
		const input = document.createElement('input');
		document.body.append(input);
		const callback = vi.fn();
		sendKey(input, callback, []);
		expect(callback).toHaveBeenCalledOnce();
	});
});
