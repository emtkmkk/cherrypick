/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { jest, beforeEach, afterEach } from '@jest/globals';
const originalNodeEnv = process.env.NODE_ENV;
beforeEach(() => { process.env.NODE_ENV = 'production'; });
afterEach(() => { process.env.NODE_ENV = originalNodeEnv; });

for (const name of ['CaptchaService', 'IdService', 'SignupService', 'EmailService']) {
	jest.unstable_mockModule(`@/core/${name}.js`, () => ({ [name]: class {} }));
}
jest.unstable_mockModule('@/core/entities/UserEntityService.js', () => ({ UserEntityService: class {} }));
jest.unstable_mockModule('@/server/api/SigninService.js', () => ({ SigninService: class {} }));
jest.unstable_mockModule('@/server/api/MkkeySsoApiService.js', () => ({ MkkeySsoApiService: class {} }));
const { SignupApiService } = await import('@/server/api/SignupApiService.js');

function setup(emailRequiredForSignup = false) {
	const identity = { mkkeyUserId: 'provider-id', mkkeyUsernameLower: 'remote' };
	const account = { id: 'local-user' };
	const meta = { disableRegistration: true, emailRequiredForSignup, preservedUsernames: [] };
	const pending = { findOneBy: jest.fn(async () => null as null | { id: string }), insertOne: jest.fn(async (value: object) => ({ ...value, id: 'pending' })), delete: jest.fn() };
	const ticket = { findOneBy: jest.fn(async () => null), update: jest.fn() };
	const signup = { signup: jest.fn(async () => ({ account, secret: 'new-native-token' })) };
	const sso = { verifyOauthToken: jest.fn(async () => identity), consumeSignupProof: jest.fn(async () => identity) };
	const email = { validateEmailForAccount: jest.fn(async () => ({ available: true })), sendEmail: jest.fn() };
	const service = new SignupApiService({ url: 'https://cp.example' } as never, meta as never,
		{ exists: async () => false } as never, {} as never, pending as never, { exists: async () => false } as never, ticket as never,
		{ validateLocalUsername: (value: string) => value === 'local', validatePassword: (value: string) => value.length >= 8, pack: async () => account } as never,
		{ gen: () => 'pending', parse: () => ({ date: new Date() }) } as never, {} as never, signup as never, {} as never, sso as never, email as never);
	const reply = { code: jest.fn() };
	const request = (extra: object = {}) => ({ body: { username: 'local', password: 'local-password', ...extra } }) as never;
	return { service, meta, pending, ticket, signup, sso, email, reply, request, identity };
}

describe('mkkey signup admission', () => {
	test('requires an invitation when no mkkey proof is supplied', async () => {
		const s = setup();
		await s.service.signup(s.request(), s.reply as never);
		expect(s.reply.code).toHaveBeenCalledWith(400);
		expect(s.signup.signup).not.toHaveBeenCalled();
	});

	test('only exempts the invitation and consumes the proof before atomically creating a linked account', async () => {
		const s = setup();
		await expect(s.service.signup(s.request({ mkkeyOauthToken: 'proof', invitationCode: 'unused' }), s.reply as never)).resolves.toMatchObject({ token: 'new-native-token' });
		expect(s.ticket.findOneBy).not.toHaveBeenCalled();
		expect(s.ticket.update).not.toHaveBeenCalled();
		expect(s.sso.consumeSignupProof).toHaveBeenCalledWith('proof', expect.anything());
		expect(s.signup.signup).toHaveBeenCalledWith(expect.objectContaining({ username: 'local', password: 'local-password', mkkeyIdentity: s.identity }));
		expect(s.sso.consumeSignupProof.mock.invocationCallOrder[0]).toBeLessThan(s.signup.signup.mock.invocationCallOrder[0]);
	});

	test('rejects invalid or already-linked identities without creating or signing in an account', async () => {
		const s = setup();
		s.sso.verifyOauthToken.mockRejectedValueOnce(new Error('MKKEY_ACCOUNT_ALREADY_LINKED'));
		await expect(s.service.signup(s.request({ mkkeyOauthToken: 'proof' }), s.reply as never)).rejects.toThrow('MKKEY_ACCOUNT_ALREADY_LINKED');
		expect(s.signup.signup).not.toHaveBeenCalled();
	});

	test('does not consume a proof when local credentials are invalid', async () => {
		const s = setup();
		await expect(s.service.signup(s.request({ password: 'short', mkkeyOauthToken: 'proof' }), s.reply as never)).rejects.toThrow('INVALID_PASSWORD');
		expect(s.sso.consumeSignupProof).not.toHaveBeenCalled();
	});

	test('still requires the configured email verification', async () => {
		const s = setup(true);
		await s.service.signup(s.request({ mkkeyOauthToken: 'proof' }), s.reply as never);
		expect(s.reply.code).toHaveBeenCalledWith(400);
		expect(s.sso.consumeSignupProof).not.toHaveBeenCalled();
		expect(s.signup.signup).not.toHaveBeenCalled();
		await s.service.signup(s.request({ mkkeyOauthToken: 'proof', emailAddress: 'user@example.com' }), s.reply as never);
		expect(s.pending.insertOne).toHaveBeenCalledWith(expect.objectContaining({ ...s.identity, username: 'local', email: 'user@example.com' }));
		expect(s.reply.code).toHaveBeenLastCalledWith(204);
		expect(s.email.sendEmail).toHaveBeenCalledTimes(1);
		expect(s.signup.signup).not.toHaveBeenCalled();
	});

	test('rejects an additional pending registration for the same provider identity', async () => {
		const s = setup(true);
		s.pending.findOneBy.mockResolvedValueOnce({ id: 'existing-pending' });
		await expect(s.service.signup(s.request({ mkkeyOauthToken: 'proof', emailAddress: 'user@example.com' }), s.reply as never)).rejects.toThrow('MKKEY_SIGNUP_PENDING');
		expect(s.sso.consumeSignupProof).not.toHaveBeenCalled();
		expect(s.pending.insertOne).not.toHaveBeenCalled();
	});
});
