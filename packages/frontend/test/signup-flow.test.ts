/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue';
import SignupDialog from '@/components/MkSignupDialog.vue';
import { runMkkeyAuth } from '@/scripts/mkkey-sso.js';
import { signinOrContinueMkkeySignup } from '@/scripts/mkkey-signup.js';
import { login } from '@/account.js';
import { alert } from '@/os.js';

vi.mock('@/i18n.js', () => ({ i18n: { ts: {
	signup: '新規登録', signupWithMkkey: 'mkkey.netでログインして登録', signupWithInvitationCode: '招待コードで登録',
} } }));
vi.mock('@/account.js', () => ({ login: vi.fn() }));
vi.mock('@/os.js', () => ({ alert: vi.fn() }));
vi.mock('@/scripts/mkkey-sso.js', () => ({ runMkkeyAuth: vi.fn(), mkkeyAuthError: () => '認証失敗' }));
vi.mock('@/scripts/mkkey-signup.js', () => ({ signinOrContinueMkkeySignup: vi.fn() }));
vi.mock('@/components/MkButton.vue', () => ({ default: {
	props: ['disabled'], emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot/></button>',
} }));
vi.mock('@/components/MkModalWindow.vue', () => ({ default: {
	template: '<div><slot/></div>', methods: { close() {} },
} }));
vi.mock('@/components/MkSignupDialog.rules.vue', () => ({ default: {
	props: ['busy'], emits: ['done', 'cancel'],
	template: '<div data-testid="rules"><button :disabled="busy" @click="$emit(\'done\')">続ける</button><button @click="$emit(\'cancel\')">キャンセル</button></div>',
} }));
vi.mock('@/components/MkSignupDialog.form.vue', () => ({ default: {
	props: ['mkkeyOauthToken', 'autoSet'], template: '<div data-testid="form">{{ mkkeyOauthToken }}</div>',
} }));

const options = { global: { stubs: { MkSpacer: { template: '<div><slot/></div>' }, Transition: false } } };
beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(runMkkeyAuth).mockResolvedValue('proof');
	vi.mocked(signinOrContinueMkkeySignup).mockResolvedValue({ type: 'signup' });
});
afterEach(cleanup);

describe('signup flow', () => {
	test('shows rules first and authenticates only after continuing', async () => {
		render(SignupDialog, { ...options, props: { method: 'mkkey' } });
		expect(screen.getByTestId('rules')).toBeTruthy();
		expect(runMkkeyAuth).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByText('続ける'));
		await waitFor(() => expect(screen.getByTestId('form').textContent).toBe('proof'));
		expect(runMkkeyAuth).toHaveBeenCalledTimes(1);
		expect(runMkkeyAuth).toHaveBeenCalledWith('signup');
	});

	test('offers both methods when adding an account and lets invitation signup skip mkkey auth', async () => {
		render(SignupDialog, options);
		expect(screen.getByText('mkkey.netでログインして登録')).toBeTruthy();
		await fireEvent.click(screen.getByText('招待コードで登録'));
		await fireEvent.click(await screen.findByText('続ける'));
		await waitFor(() => expect(screen.getByTestId('form').textContent).toBe(''));
		expect(runMkkeyAuth).not.toHaveBeenCalled();
	});

	test('returns a linked account to the caller without switching the current account', async () => {
		vi.mocked(signinOrContinueMkkeySignup).mockResolvedValue({ type: 'signedIn', id: 'existing', token: 'local-token' });
		const onSignin = vi.fn();
		render(SignupDialog, { ...options, props: { method: 'mkkey', onSignin } });
		await fireEvent.click(screen.getByText('続ける'));
		await waitFor(() => expect(onSignin).toHaveBeenCalledWith({ id: 'existing', token: 'local-token' }));
		expect(login).not.toHaveBeenCalled();
		expect(screen.queryByTestId('form')).toBeNull();
	});

	test('logs in the linked account for the logged-out entry point', async () => {
		vi.mocked(signinOrContinueMkkeySignup).mockResolvedValue({ type: 'signedIn', id: 'existing', token: 'local-token' });
		render(SignupDialog, { ...options, props: { method: 'mkkey', autoSet: true } });
		await fireEvent.click(screen.getByText('続ける'));
		await waitFor(() => expect(login).toHaveBeenCalledWith('local-token'));
	});

	test('keeps the rules open after authentication fails so the user can retry', async () => {
		vi.mocked(runMkkeyAuth).mockRejectedValue(new Error('failed'));
		render(SignupDialog, { ...options, props: { method: 'mkkey' } });
		await fireEvent.click(screen.getByText('続ける'));
		await waitFor(() => expect(alert).toHaveBeenCalled());
		expect(screen.getByTestId('rules')).toBeTruthy();
		expect(screen.queryByTestId('form')).toBeNull();
	});

	test('cancelling during provider authentication prevents a later login or registration', async () => {
		let complete!: (token: string) => void;
		vi.mocked(runMkkeyAuth).mockReturnValue(new Promise(resolve => { complete = resolve; }));
		render(SignupDialog, { ...options, props: { method: 'mkkey', autoSet: true } });
		await fireEvent.click(screen.getByText('続ける'));
		await fireEvent.click(screen.getByText('キャンセル'));
		complete('proof');
		await Promise.resolve();
		expect(signinOrContinueMkkeySignup).not.toHaveBeenCalled();
		expect(login).not.toHaveBeenCalled();
		expect(screen.queryByTestId('form')).toBeNull();
	});
});
