/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { jest } from '@jest/globals';
import * as argon2 from 'argon2';

for (const name of ['SigninService', 'AuthenticateService', 'RateLimiterService']) {
	jest.unstable_mockModule(`@/server/api/${name}.js`, () => ({ [name]: class {} }));
}
jest.unstable_mockModule('@/core/UserAuthService.js', () => ({ UserAuthService: class {} }));
const { MkkeySsoApiService } = await import('@/server/api/MkkeySsoApiService.js');

type Mode = 'signin' | 'signup' | 'link';
const origin = 'https://cp.example';
const browser = 'b'.repeat(43);
let passwordHash: string;
beforeAll(async () => { passwordHash = await argon2.hash('local-password'); });

function setup() {
	const values = new Map<string, { raw: string; expires: number; }>();
	const redis = {
		get: jest.fn(async (key: string) => {
			const value = values.get(key);
			return value && value.expires > Date.now() ? value.raw : null;
		}),
		set: jest.fn(async (key: string, raw: string, _ex: string, seconds: number) => {
			values.set(key, { raw, expires: Date.now() + seconds * 1000 }); return 'OK';
		}),
		eval: jest.fn(async (_script: string, _keys: number, key: string, raw: string) => {
			const value = values.get(key);
			if (!value || value.raw !== raw || value.expires <= Date.now()) return 0;
			values.delete(key); return 1;
		}),
	};
	const user = { id: 'local-user', host: null as string | null, isSuspended: false, isDeleted: false, token: 'native-token' };
	const profile = { password: passwordHash, twoFactorEnabled: false, twoFactorSecret: 'totp-secret' as string | null };
	const links = {
		findOne: jest.fn(async (_query: unknown) => ({ user })),
		findOneBy: jest.fn(async (_query: unknown) => null as { mkkeyUsernameLower: string } | null),
		existsBy: jest.fn(async (_query: unknown) => false),
		insert: jest.fn(async (_data: unknown) => {}), update: jest.fn(async (_query: unknown, _data: unknown) => {}), delete: jest.fn(async (_query: unknown) => {}),
	};
	const profiles = { findOneByOrFail: jest.fn(async (_query: unknown) => profile) };
	const signin = { signin: jest.fn((_request: unknown, _reply: unknown, _user: unknown) => ({ finished: true, i: 'native-token' })) };
	const authenticate = { authenticate: jest.fn(async (_token: string) => [user, null, null] as unknown[]) };
	const twoFactor = { twoFactorAuthenticate: jest.fn(async (_profile: unknown, token: string) => { if (token !== '123456') throw new Error('bad code'); }) };
	const limiter = { limit: jest.fn(async (_limit: unknown, _ip: unknown) => {}) };
	const service = new MkkeySsoApiService({ url: origin, apiUrl: origin + '/api' } as never, redis as never, links as never, profiles as never, signin as never, authenticate as never, twoFactor as never, limiter as never);
	const reply = { setCookie: jest.fn(), header: jest.fn(), type: jest.fn() };
	const request = (body: object, cookie = browser, requestOrigin = origin) => ({ body, headers: { origin: requestOrigin }, cookies: { mkkey_sso_browser: cookie }, ip: '127.0.0.1' });
	const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ ok: true, token: 'provider-access-secret', user: { id: 'mkkey-stable-id', username: 'MkkeyName', host: null } }) } as Response);

	async function proof(mode: Mode, localAuth: object = {}) {
		const flow = await service.getAuthorizeUrl(request({ mode, ...localAuth }) as never, reply as never);
		const html = await service.callback({ ...request({}), query: { session: flow.session } } as never, reply as never);
		const data = JSON.parse(html.match(/postMessage\((\{.*?\}),/)![1]) as { oauthToken: string; };
		return { ...flow, html, oauthToken: data.oauthToken };
	}

	return { service, values, redis, user, profile, links, profiles, signin, authenticate, twoFactor, limiter, reply, request, fetchMock, proof };
}

afterEach(() => jest.restoreAllMocks());

describe('mkkey authentication', () => {
	test('uses the actual MiAuth endpoint and an HttpOnly browser binding, without client secrets', async () => {
		const t = setup();
		const result = await t.service.getAuthorizeUrl(t.request({ mode: 'signin' }) as never, t.reply as never);
		const url = new URL(result.url);
		expect(url.origin).toBe('https://mkkey.net');
		expect(url.pathname).toBe(`/miauth/${result.session}`);
		expect(url.searchParams.get('permission')).toBe('read:account');
		expect(url.searchParams.get('callback')).toBe(origin + '/api/mkkey-sso/callback');
		expect(t.reply.setCookie).toHaveBeenCalledWith('mkkey_sso_browser', browser, expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'lax', path: '/api' }));
	});

	test('signs in a linked account, sends only an opaque proof to the correct opener origin, and prevents replay', async () => {
		const t = setup(); const flow = await t.proof('signin');
		expect(flow.html).toContain(JSON.stringify(origin));
		expect(flow.html).not.toContain('provider-access-secret');
		expect(flow.html).not.toContain('mkkey-stable-id');
		expect(t.reply.header).toHaveBeenCalledWith('Content-Security-Policy', expect.stringContaining('nonce-'));
		const request = t.request({ oauthToken: flow.oauthToken });
		expect(await t.service.signin(request as never, t.reply as never)).toEqual({ finished: true, i: 'native-token' });
		expect(t.links.findOne).toHaveBeenCalledWith({ where: { mkkeyUserId: 'mkkey-stable-id' }, relations: ['user'] });
		await expect(t.service.signin(request as never, t.reply as never)).rejects.toThrow('MKKEY_AUTH_EXPIRED');
		expect(t.signin.signin).toHaveBeenCalledTimes(1);
	});

	test('rejects a callback from another browser without consuming the real flow', async () => {
		const t = setup(); const flow = await t.service.getAuthorizeUrl(t.request({ mode: 'signin' }) as never, t.reply as never);
		await expect(t.service.callback({ ...t.request({}, 'c'.repeat(43)), query: { session: flow.session } } as never, t.reply as never)).rejects.toThrow('MKKEY_AUTH_EXPIRED');
		expect(t.fetchMock).not.toHaveBeenCalled();
		await expect(t.service.callback({ ...t.request({}), query: { session: flow.session } } as never, t.reply as never)).resolves.toContain('postMessage');
		await expect(t.service.callback({ ...t.request({}), query: { session: flow.session } } as never, t.reply as never)).rejects.toThrow('MKKEY_AUTH_EXPIRED');
	});

	test('rejects forged old signed tokens, expired proofs, and proofs from another browser', async () => {
		const t = setup(); const flow = await t.proof('signin');
		await expect(t.service.signin(t.request({ oauthToken: 'signed.public-config-id' }) as never, t.reply as never)).rejects.toThrow('MKKEY_AUTH_EXPIRED');
		await expect(t.service.signin(t.request({ oauthToken: flow.oauthToken }, 'x'.repeat(43)) as never, t.reply as never)).rejects.toThrow('MKKEY_AUTH_EXPIRED');
		jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 601_000);
		await expect(t.service.signin(t.request({ oauthToken: flow.oauthToken }) as never, t.reply as never)).rejects.toThrow('MKKEY_AUTH_EXPIRED');
		expect(t.signin.signin).not.toHaveBeenCalled();
	});

	test('only one simultaneous signin can consume the proof', async () => {
		const t = setup(); const flow = await t.proof('signin');
		const results = await Promise.allSettled([0, 1].map(() => t.service.signin(t.request({ oauthToken: flow.oauthToken }) as never, t.reply as never)));
		expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
		expect(t.signin.signin).toHaveBeenCalledTimes(1);
	});

	test('does not authenticate a different account with the same display username', async () => {
		const t = setup(); const flow = await t.proof('signin');
		t.links.findOne.mockResolvedValueOnce(null as never);
		await expect(t.service.signin(t.request({ oauthToken: flow.oauthToken }) as never, t.reply as never)).rejects.toThrow('MKKEY_ACCOUNT_NOT_LINKED');
		expect(t.links.findOne.mock.calls[0][0]).toEqual({ where: { mkkeyUserId: 'mkkey-stable-id' }, relations: ['user'] });
	});

	test.each(['isSuspended', 'isDeleted'] as const)('does not sign in a local account with %s', async flag => {
		const t = setup(); const flow = await t.proof('signin'); t.user[flag] = true;
		await expect(t.service.signin(t.request({ oauthToken: flow.oauthToken }) as never, t.reply as never)).rejects.toThrow('MKKEY_ACCOUNT_NOT_LINKED');
		expect(t.signin.signin).not.toHaveBeenCalled();
	});

	test('preserves local two-factor authentication and only consumes a valid proof after it succeeds', async () => {
		const t = setup(); const flow = await t.proof('signin'); t.profile.twoFactorEnabled = true;
		expect(await t.service.signin(t.request({ oauthToken: flow.oauthToken }) as never, t.reply as never)).toEqual({ finished: false, next: 'totp' });
		await expect(t.service.signin(t.request({ oauthToken: flow.oauthToken, token: 'wrong' }) as never, t.reply as never)).rejects.toThrow('LOCAL_AUTH_FAILED');
		expect(t.signin.signin).not.toHaveBeenCalled();
		expect(await t.service.signin(t.request({ oauthToken: flow.oauthToken, token: '123456' }) as never, t.reply as never)).toMatchObject({ finished: true });
	});

	test('does not bypass a security-key-only local account', async () => {
		const t = setup(); const flow = await t.proof('signin'); t.profile.twoFactorEnabled = true; t.profile.twoFactorSecret = null;
		await expect(t.service.signin(t.request({ oauthToken: flow.oauthToken }) as never, t.reply as never)).rejects.toThrow('LOCAL_SIGNIN_REQUIRED');
	});

	test('an unlinked signup continues registration without consuming its proof', async () => {
		const t = setup(); const flow = await t.proof('signup'); const request = t.request({});
		t.links.findOne.mockResolvedValue(null as never);
		expect(await t.service.signin(t.request({ oauthToken: flow.oauthToken }) as never, t.reply as never)).toEqual({ finished: false, next: 'signup' });
		expect(t.signin.signin).not.toHaveBeenCalled();
		expect(await t.service.consumeSignupProof(flow.oauthToken, request as never)).toEqual({ mkkeyUserId: 'mkkey-stable-id', mkkeyUsernameLower: 'mkkeyname' });
		await expect(t.service.consumeSignupProof(flow.oauthToken, request as never)).rejects.toThrow('MKKEY_AUTH_EXPIRED');
	});

	test('a linked signup signs in the existing account and prevents proof replay', async () => {
		const t = setup(); const flow = await t.proof('signup');
		const request = t.request({ oauthToken: flow.oauthToken });
		expect(await t.service.signin(request as never, t.reply as never)).toEqual({ finished: true, i: 'native-token' });
		expect(t.links.insert).not.toHaveBeenCalled();
		await expect(t.service.signin(request as never, t.reply as never)).rejects.toThrow('MKKEY_AUTH_EXPIRED');
	});

	test('a linked signup still requires local two-factor authentication', async () => {
		const t = setup(); const flow = await t.proof('signup'); t.profile.twoFactorEnabled = true;
		expect(await t.service.signin(t.request({ oauthToken: flow.oauthToken }) as never, t.reply as never)).toEqual({ finished: false, next: 'totp' });
		await expect(t.service.signin(t.request({ oauthToken: flow.oauthToken, token: 'wrong' }) as never, t.reply as never)).rejects.toThrow('LOCAL_AUTH_FAILED');
		expect(t.signin.signin).not.toHaveBeenCalled();
		expect(await t.service.signin(t.request({ oauthToken: flow.oauthToken, token: '123456' }) as never, t.reply as never)).toMatchObject({ finished: true });
	});

	test.each(['isSuspended', 'isDeleted'] as const)('a linked signup cannot register again or sign in when %s', async flag => {
		const t = setup(); const flow = await t.proof('signup'); t.user[flag] = true; t.links.existsBy.mockResolvedValue(true);
		await expect(t.service.signin(t.request({ oauthToken: flow.oauthToken }) as never, t.reply as never)).rejects.toThrow('MKKEY_ACCOUNT_NOT_LINKED');
		expect(t.signin.signin).not.toHaveBeenCalled();
	});

	test('a linking proof cannot be used to sign in', async () => {
		const t = setup(); const flow = await t.proof('link', { i: 'native', password: 'local-password' });
		await expect(t.service.signin(t.request({ oauthToken: flow.oauthToken }) as never, t.reply as never)).rejects.toThrow('INVALID_MKKEY_TOKEN_PURPOSE');
	});

	test('a linked identity cannot create another account using a new signup proof', async () => {
		const t = setup(); const flow = await t.proof('signup'); t.links.existsBy.mockResolvedValue(true);
		await expect(t.service.consumeSignupProof(flow.oauthToken, t.request({}) as never)).rejects.toThrow('MKKEY_ACCOUNT_ALREADY_LINKED');
	});

	test('linking requires local password authentication and binds the completion to that local account', async () => {
		const t = setup();
		await expect(t.service.getAuthorizeUrl(t.request({ mode: 'link', i: 'native', password: 'wrong' }) as never, t.reply as never)).rejects.toThrow('LOCAL_AUTH_FAILED');
		const flow = await t.proof('link', { i: 'native', password: 'local-password' });
		const request = t.request({ oauthToken: flow.oauthToken, i: 'native' });
		t.user.id = 'other-local-user';
		await expect(t.service.link(request as never)).rejects.toThrow('INVALID_MKKEY_TOKEN_PURPOSE');
		t.user.id = 'local-user';
		expect(await t.service.link(request as never)).toEqual({ linked: true, username: 'mkkeyname' });
		expect(t.links.insert).toHaveBeenCalledWith({ userId: 'local-user', mkkeyUserId: 'mkkey-stable-id', mkkeyUsernameLower: 'mkkeyname' });
	});

	test('application tokens cannot link or unlink accounts', async () => {
		const t = setup(); t.authenticate.authenticate.mockResolvedValue([t.user, { permission: ['read:account'] }, null]);
		await expect(t.service.getAuthorizeUrl(t.request({ mode: 'link', i: 'app', password: 'local-password' }) as never, t.reply as never)).rejects.toThrow('LOCAL_SIGNIN_REQUIRED');
		await expect(t.service.unlink(t.request({ i: 'app', password: 'local-password' }) as never)).rejects.toThrow('LOCAL_SIGNIN_REQUIRED');
	});

	test('unlinking is forbidden even with valid native credentials and preserves the link', async () => {
		const t = setup();
		await expect(t.service.unlink(t.request({ i: 'native', password: 'wrong' }) as never)).rejects.toThrow('MKKEY_UNLINK_DISABLED');
		await expect(t.service.unlink(t.request({ i: 'native', password: 'local-password' }) as never)).rejects.toThrow('MKKEY_UNLINK_DISABLED');
		expect(t.links.delete).not.toHaveBeenCalled();
	});

	test('rejects denied MiAuth and invalid provider users', async () => {
		const t = setup(); t.fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: false }) } as Response);
		await expect(t.proof('signin')).rejects.toThrow('MKKEY_AUTH_FAILED');
	});

	test('rejects cross-origin starts and rate-limited attempts', async () => {
		const t = setup();
		await expect(t.service.getAuthorizeUrl(t.request({ mode: 'signin' }, browser, 'https://evil.example') as never, t.reply as never)).rejects.toThrow('INVALID_ORIGIN');
		t.limiter.limit.mockRejectedValue(new Error('limit'));
		await expect(t.service.getAuthorizeUrl(t.request({ mode: 'signin' }) as never, t.reply as never)).rejects.toThrow('TOO_MANY_AUTHENTICATION_FAILURES');
	});
});
