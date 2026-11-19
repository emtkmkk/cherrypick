/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import * as argon2 from 'argon2';
import bcrypt from 'bcryptjs';
import { DI } from '@/di-symbols.js';
import type { MkkeyAccountLinksRepository, UserProfilesRepository } from '@/models/_.js';
import type { Config } from '@/config.js';
import type { MiLocalUser } from '@/models/User.js';
import { FastifyReplyError } from '@/misc/fastify-reply-error.js';
import { getIpHash } from '@/misc/get-ip-hash.js';
import { UserAuthService } from '@/core/UserAuthService.js';
import { AuthenticateService } from './AuthenticateService.js';
import { SigninService } from './SigninService.js';
import { RateLimiterService } from './RateLimiterService.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

export type MkkeySsoMode = 'signin' | 'signup' | 'link';
export type MkkeySsoStartBody = { mode: MkkeySsoMode; i?: string; password?: string; token?: string; };
export type MkkeySsoProofBody = { oauthToken: string; i?: string; token?: string; };
export type MkkeyIdentity = { mkkeyUserId: string; mkkeyUsernameLower: string; };
type Flow = { mode: MkkeySsoMode; binding: string; userId?: string; };
type Proof = Flow & MkkeyIdentity;
const provider = 'https://mkkey.net';
const cookieName = 'mkkey_sso_browser';
const ttl = 600;
const opaquePattern = /^[A-Za-z0-9_-]{43}$/;
const sessionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const consumeScript = 'if redis.call(\'GET\', KEYS[1]) == ARGV[1] then return redis.call(\'DEL\', KEYS[1]) else return 0 end';

@Injectable()
export class MkkeySsoApiService {
	constructor(
		@Inject(DI.config) private config: Config,
		@Inject(DI.redis) private redis: Redis.Redis,
		@Inject(DI.mkkeyAccountLinksRepository) private links: MkkeyAccountLinksRepository,
		@Inject(DI.userProfilesRepository) private profiles: UserProfilesRepository,
		private signinService: SigninService,
		private authenticateService: AuthenticateService,
		private userAuthService: UserAuthService,
		private rateLimiterService: RateLimiterService,
	) {}

	private key(kind: string, value: string) {
		return `mkkey-sso:${kind}:${value}`;
	}

	private assertOrigin(request: FastifyRequest) {
		if (request.headers.origin !== this.config.url) throw new FastifyReplyError(403, 'INVALID_ORIGIN');
		if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) throw new FastifyReplyError(400, 'INVALID_REQUEST');
	}

	private binding(request: FastifyRequest): string {
		const cookie = request.cookies[cookieName];
		if (!cookie || !opaquePattern.test(cookie)) throw new FastifyReplyError(400, 'MKKEY_AUTH_EXPIRED');
		return createHash('sha256').update(cookie).digest('hex');
	}

	private setCookie(reply: FastifyReply, cookie: string | undefined) {
		if (!cookie) throw new FastifyReplyError(400, 'MKKEY_AUTH_EXPIRED');
		reply.setCookie(cookieName, cookie, { httpOnly: true, secure: this.config.url.startsWith('https:'), sameSite: 'lax', path: '/api', maxAge: ttl });
	}

	private async limit(request: FastifyRequest, action: string, max = 20) {
		try {
			await this.rateLimiterService.limit({ key: `mkkey-sso:${action}`, duration: 60 * 60 * 1000, max, minInterval: 500 }, getIpHash(request.ip));
		} catch {
			throw new FastifyReplyError(429, 'TOO_MANY_AUTHENTICATION_FAILURES');
		}
	}

	private async nativeUser(token: unknown): Promise<MiLocalUser> {
		if (typeof token !== 'string' || token.length > 256) throw new FastifyReplyError(401, 'LOCAL_SIGNIN_REQUIRED');
		try {
			const [user, accessToken, flashToken] = await this.authenticateService.authenticate(token);
			if (!user || accessToken || flashToken || user.host != null || user.isSuspended || user.isDeleted) throw new Error();
			return user;
		} catch {
			throw new FastifyReplyError(401, 'LOCAL_SIGNIN_REQUIRED');
		}
	}

	private async reauthenticate(user: MiLocalUser, password: unknown, token: unknown) {
		const profile = await this.profiles.findOneByOrFail({ userId: user.id });
		if (typeof password !== 'string' || password.length > 1024 || !profile.password) throw new FastifyReplyError(403, 'LOCAL_AUTH_FAILED');
		let valid = false;
		try {
			valid = await argon2.verify(profile.password, password);
		} catch { /* Legacy accounts may have bcrypt hashes. */ }
		if (!valid) valid = await bcrypt.compare(password, profile.password).catch(() => false);
		if (!valid) throw new FastifyReplyError(403, 'LOCAL_AUTH_FAILED');
		if (profile.twoFactorEnabled) {
			if (!profile.twoFactorSecret || typeof token !== 'string') throw new FastifyReplyError(403, 'LOCAL_TWO_FACTOR_REQUIRED');
			await this.userAuthService.twoFactorAuthenticate(profile, token).catch(() => { throw new FastifyReplyError(403, 'LOCAL_AUTH_FAILED'); });
		}
	}

	private async record<T extends Flow>(kind: string, value: string, request: FastifyRequest): Promise<{ key: string; raw: string; data: T; }> {
		if (typeof value !== 'string' || !(kind === 'flow' ? sessionPattern : opaquePattern).test(value)) throw new FastifyReplyError(400, 'MKKEY_AUTH_EXPIRED');
		const key = this.key(kind, value);
		const raw = await this.redis.get(key);
		if (!raw) throw new FastifyReplyError(400, 'MKKEY_AUTH_EXPIRED');
		const data = JSON.parse(raw) as T;
		if (data.binding !== this.binding(request)) throw new FastifyReplyError(400, 'MKKEY_AUTH_EXPIRED');
		return { key, raw, data };
	}

	private async consume(record: { key: string; raw: string; }) {
		if (await this.redis.eval(consumeScript, 1, record.key, record.raw) !== 1) throw new FastifyReplyError(400, 'MKKEY_AUTH_EXPIRED');
	}

	public async getAuthorizeUrl(request: FastifyRequest<{ Body: MkkeySsoStartBody; }>, reply: FastifyReply) {
		this.assertOrigin(request);
		await this.limit(request, 'start', 60);
		const { mode } = request.body;
		if (!['signin', 'signup', 'link'].includes(mode)) throw new FastifyReplyError(400, 'INVALID_MODE');
		let userId: string | undefined;
		if (mode === 'link') {
			const user = await this.nativeUser(request.body.i);
			await this.reauthenticate(user, request.body.password, request.body.token);
			userId = user.id;
		}
		const existing = request.cookies[cookieName];
		const browser = existing && opaquePattern.test(existing) ? existing : randomBytes(32).toString('base64url');
		this.setCookie(reply, browser);
		const session = randomUUID();
		const flow: Flow = { mode, binding: createHash('sha256').update(browser).digest('hex'), userId };
		await this.redis.set(this.key('flow', session), JSON.stringify(flow), 'EX', ttl);
		// mkkey implements MiAuth. Its Mastodon /oauth compatibility endpoints are not a standard OAuth issuer.
		const callback = new URL(`${this.config.apiUrl}/mkkey-sso/callback`);
		const url = new URL(`${provider}/miauth/${session}`);
		url.search = new URLSearchParams({ name: `CherryPick (${new URL(this.config.url).host})`, callback: callback.href, permission: 'read:account' }).toString();
		return { url: url.href, session };
	}

	public async callback(request: FastifyRequest<{ Querystring: { session?: string; }; }>, reply: FastifyReply) {
		const session = request.query.session;
		if (typeof session !== 'string') throw new FastifyReplyError(400, 'INVALID_MKKEY_CALLBACK');
		const flow = await this.record<Flow>('flow', session, request);
		await this.consume(flow);
		let identity: MkkeyIdentity;
		try {
			const response = await fetch(`${provider}/api/miauth/${session}/check`, {
				method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
				signal: AbortSignal.timeout(10_000), redirect: 'error',
			});
			if (!response.ok) throw new Error();
			const result = await response.json() as { ok?: boolean; user?: { id?: unknown; username?: unknown; host?: unknown; isSuspended?: boolean; isDeleted?: boolean; }; };
			const user = result.user;
			if (result.ok !== true || !user || typeof user.id !== 'string' || !user.id || user.id.length > 128 ||
				typeof user.username !== 'string' || !user.username || user.username.length > 128 || user.host != null || user.isSuspended || user.isDeleted) throw new Error();
			identity = { mkkeyUserId: user.id, mkkeyUsernameLower: user.username.toLowerCase() };
		} catch {
			throw new FastifyReplyError(400, 'MKKEY_AUTH_FAILED');
		}
		const oauthToken = randomBytes(32).toString('base64url');
		await this.redis.set(this.key('proof', oauthToken), JSON.stringify({ ...flow.data, ...identity } satisfies Proof), 'EX', ttl);
		this.setCookie(reply, request.cookies[cookieName]);
		const nonce = randomBytes(24).toString('base64');
		const message = JSON.stringify({ source: 'mkkey-sso', mode: flow.data.mode, session, oauthToken });
		reply.header('Cache-Control', 'no-store');
		reply.header('Referrer-Policy', 'no-referrer');
		reply.header('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`);
		reply.type('text/html; charset=utf-8');
		return `<!doctype html><html lang="ja"><meta charset="utf-8"><title>もこきー認証</title><body><p>認証が完了しました。このウィンドウを閉じて元の画面へ戻ってください。</p><script nonce="${nonce}">window.opener?.postMessage(${message},${JSON.stringify(this.config.url)});window.close();</script></body></html>`;
	}

	public async verifyOauthToken(token: string, request: FastifyRequest): Promise<MkkeyIdentity> {
		this.assertOrigin(request);
		const proof = await this.record<Proof>('proof', token, request);
		if (proof.data.mode !== 'signup') throw new FastifyReplyError(400, 'INVALID_MKKEY_TOKEN_PURPOSE');
		if (await this.links.existsBy({ mkkeyUserId: proof.data.mkkeyUserId })) throw new FastifyReplyError(409, 'MKKEY_ACCOUNT_ALREADY_LINKED');
		return { mkkeyUserId: proof.data.mkkeyUserId, mkkeyUsernameLower: proof.data.mkkeyUsernameLower };
	}

	public async consumeSignupProof(token: string, request: FastifyRequest) {
		const identity = await this.verifyOauthToken(token, request);
		const proof = await this.record<Proof>('proof', token, request);
		await this.consume(proof);
		return identity;
	}

	public async findLinkedUser(identity: MkkeyIdentity): Promise<MiLocalUser | null> {
		const link = await this.links.findOne({ where: { mkkeyUserId: identity.mkkeyUserId }, relations: ['user'] });
		if (!link?.user || link.user.host != null || link.user.isSuspended || link.user.isDeleted) return null;
		return link.user as MiLocalUser;
	}

	public async signin(request: FastifyRequest<{ Body: MkkeySsoProofBody; }>, reply: FastifyReply) {
		this.assertOrigin(request);
		await this.limit(request, 'signin', 10);
		const proof = await this.record<Proof>('proof', request.body.oauthToken, request);
		if (proof.data.mode !== 'signin') throw new FastifyReplyError(400, 'INVALID_MKKEY_TOKEN_PURPOSE');
		const user = await this.findLinkedUser(proof.data);
		if (!user) throw new FastifyReplyError(404, 'MKKEY_ACCOUNT_NOT_LINKED');
		const profile = await this.profiles.findOneByOrFail({ userId: user.id });
		if (profile.twoFactorEnabled) {
			if (!profile.twoFactorSecret) throw new FastifyReplyError(403, 'LOCAL_SIGNIN_REQUIRED');
			if (!request.body.token) return { finished: false as const, next: 'totp' as const };
			if (typeof request.body.token !== 'string' || request.body.token.length > 128) throw new FastifyReplyError(403, 'LOCAL_AUTH_FAILED');
			await this.userAuthService.twoFactorAuthenticate(profile, request.body.token).catch(() => { throw new FastifyReplyError(403, 'LOCAL_AUTH_FAILED'); });
		}
		await this.consume(proof);
		await this.links.update({ mkkeyUserId: proof.data.mkkeyUserId }, { mkkeyUsernameLower: proof.data.mkkeyUsernameLower });
		return this.signinService.signin(request, reply, user);
	}

	public async status(request: FastifyRequest<{ Body: { i?: string; }; }>) {
		this.assertOrigin(request);
		const user = await this.nativeUser(request.body.i);
		const link = await this.links.findOneBy({ userId: user.id });
		return { linked: link != null, username: link?.mkkeyUsernameLower ?? null };
	}

	public async link(request: FastifyRequest<{ Body: MkkeySsoProofBody; }>) {
		this.assertOrigin(request);
		await this.limit(request, 'link');
		const user = await this.nativeUser(request.body.i);
		const proof = await this.record<Proof>('proof', request.body.oauthToken, request);
		if (proof.data.mode !== 'link' || proof.data.userId !== user.id) throw new FastifyReplyError(403, 'INVALID_MKKEY_TOKEN_PURPOSE');
		await this.consume(proof);
		try {
			await this.links.insert({ userId: user.id, mkkeyUserId: proof.data.mkkeyUserId, mkkeyUsernameLower: proof.data.mkkeyUsernameLower });
		} catch (error) {
			if ((error as { code?: string }).code === '23505') throw new FastifyReplyError(409, 'MKKEY_ACCOUNT_ALREADY_LINKED');
			throw error;
		}
		return { linked: true };
	}

	public async unlink(request: FastifyRequest<{ Body: { i?: string; password?: string; token?: string; }; }>) {
		this.assertOrigin(request);
		await this.limit(request, 'unlink', 10);
		const user = await this.nativeUser(request.body.i);
		await this.reauthenticate(user, request.body.password, request.body.token);
		await this.links.delete({ userId: user.id });
		return { linked: false };
	}
}
