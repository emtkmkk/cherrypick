/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { MkkeyAccountLinksRepository } from '@/models/_.js';
import type { Config } from '@/config.js';
import { FastifyReplyError } from '@/misc/fastify-reply-error.js';
import type { MiLocalUser } from '@/models/User.js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { SigninService } from './SigninService.js';

type MkkeyMeResponse = {
	id?: string;
	username?: string;
};

type MkkeyMode = 'signin' | 'signup';

type MkkeyStatePayload = {
	mode: MkkeyMode;
	exp: number;
};

type MkkeyOauthPayload = {
	mkkeyUserId: string;
	mkkeyUsernameLower: string;
	exp: number;
};

@Injectable()
export class MkkeySsoApiService {
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.mkkeyAccountLinksRepository)
		private mkkeyAccountLinksRepository: MkkeyAccountLinksRepository,

		private signinService: SigninService,
	) {
	}

	private get signingSecret(): string {
		return process.env.MKKEY_OAUTH_SIGNING_SECRET ?? this.config.id;
	}

	private get clientId(): string {
		const value = process.env.MKKEY_OAUTH_CLIENT_ID;
		if (!value) throw new FastifyReplyError(500, 'MKKEY_OAUTH_CLIENT_ID_NOT_CONFIGURED');
		return value;
	}

	private get clientSecret(): string {
		const value = process.env.MKKEY_OAUTH_CLIENT_SECRET;
		if (!value) throw new FastifyReplyError(500, 'MKKEY_OAUTH_CLIENT_SECRET_NOT_CONFIGURED');
		return value;
	}

	private get redirectUri(): string {
		return process.env.MKKEY_OAUTH_REDIRECT_URI ?? `${this.config.apiUrl}/mkkey-sso/callback`;
	}

	private get authorizeEndpoint(): string {
		return process.env.MKKEY_OAUTH_AUTHORIZE_URL ?? 'https://mkkey.net/oauth/authorize';
	}

	private get tokenEndpoint(): string {
		return process.env.MKKEY_OAUTH_TOKEN_URL ?? 'https://mkkey.net/oauth/token';
	}

	private get meEndpoint(): string {
		return process.env.MKKEY_OAUTH_ME_URL ?? 'https://mkkey.net/api/i';
	}

	private signPayload(payload: object): string {
		const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
		const signature = createHmac('sha256', this.signingSecret).update(encodedPayload).digest('base64url');
		return `${encodedPayload}.${signature}`;
	}

	private verifyPayload<T>(token: string): T {
		const [encodedPayload, signature] = token.split('.');
		if (!encodedPayload || !signature) throw new FastifyReplyError(400, 'INVALID_MKKEY_TOKEN');

		const expected = createHmac('sha256', this.signingSecret).update(encodedPayload).digest('base64url');
		const sigBuffer = Buffer.from(signature);
		const expectedBuffer = Buffer.from(expected);
		if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
			throw new FastifyReplyError(400, 'INVALID_MKKEY_TOKEN');
		}

		return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf-8')) as T;
	}

	private async fetchMkkeyUser(accessToken: string): Promise<{ id: string; usernameLower: string; }> {
		const meRes = await fetch(this.meEndpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ i: accessToken }),
		}).catch(() => {
			throw new FastifyReplyError(400, 'MKKEY_AUTH_FAILED');
		});

		if (!meRes.ok) throw new FastifyReplyError(400, 'MKKEY_AUTH_FAILED');

		const me = await meRes.json() as MkkeyMeResponse;
		if (!me.id || !me.username) throw new FastifyReplyError(400, 'MKKEY_AUTH_FAILED');

		return {
			id: me.id,
			usernameLower: me.username.toLowerCase(),
		};
	}

	public createAuthorizeUrl(mode: MkkeyMode): string {
		const state = this.signPayload({
			mode,
			exp: Date.now() + (1000 * 60 * 10),
		} satisfies MkkeyStatePayload);

		const params = new URLSearchParams({
			response_type: 'code',
			client_id: this.clientId,
			redirect_uri: this.redirectUri,
			scope: 'read:account',
			state,
		});

		return `${this.authorizeEndpoint}?${params.toString()}`;
	}

	public getAuthorizeUrl(request: FastifyRequest<{ Body: { mode: MkkeyMode; } }>) {
		const mode = request.body.mode;
		if (mode !== 'signin' && mode !== 'signup') throw new FastifyReplyError(400, 'INVALID_MODE');
		return {
			url: this.createAuthorizeUrl(mode),
		};
	}

	public async callback(request: FastifyRequest<{ Querystring: { code?: string; state?: string; }; }>, reply: FastifyReply) {
		const code = request.query.code;
		const state = request.query.state;
		if (!code || !state) throw new FastifyReplyError(400, 'INVALID_OAUTH_CALLBACK');

		const statePayload = this.verifyPayload<MkkeyStatePayload>(state);
		if (statePayload.exp < Date.now()) throw new FastifyReplyError(400, 'MKKEY_STATE_EXPIRED');

		const tokenRes = await fetch(this.tokenEndpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				client_id: this.clientId,
				client_secret: this.clientSecret,
				redirect_uri: this.redirectUri,
			}),
		}).catch(() => {
			throw new FastifyReplyError(400, 'MKKEY_TOKEN_EXCHANGE_FAILED');
		});

		if (!tokenRes.ok) throw new FastifyReplyError(400, 'MKKEY_TOKEN_EXCHANGE_FAILED');
		const tokenBody = await tokenRes.json() as { access_token?: string; };
		if (!tokenBody.access_token) throw new FastifyReplyError(400, 'MKKEY_TOKEN_EXCHANGE_FAILED');

		const mkkeyUser = await this.fetchMkkeyUser(tokenBody.access_token);
		const oauthToken = this.signPayload({
			mkkeyUserId: mkkeyUser.id,
			mkkeyUsernameLower: mkkeyUser.usernameLower,
			exp: Date.now() + (1000 * 60 * 10),
		} satisfies MkkeyOauthPayload);

		reply.type('text/html; charset=utf-8');
		return `<!doctype html><html><body><script>
			window.opener?.postMessage(${JSON.stringify({ source: 'mkkey-sso', mode: statePayload.mode, oauthToken })}, '*');
			window.close();
		</script></body></html>`;
	}

	public verifyOauthToken(token: string): { mkkeyUserId: string; mkkeyUsernameLower: string; } {
		const payload = this.verifyPayload<MkkeyOauthPayload>(token);
		if (payload.exp < Date.now()) throw new FastifyReplyError(400, 'MKKEY_OAUTH_TOKEN_EXPIRED');
		if (!payload.mkkeyUserId || !payload.mkkeyUsernameLower) throw new FastifyReplyError(400, 'INVALID_MKKEY_OAUTH_TOKEN');
		return {
			mkkeyUserId: payload.mkkeyUserId,
			mkkeyUsernameLower: payload.mkkeyUsernameLower,
		};
	}

	public async findLinkedUser(payload: { mkkeyUserId: string; mkkeyUsernameLower: string; }): Promise<MiLocalUser | null> {
		const link = await this.mkkeyAccountLinksRepository.findOne({
			where: [{ mkkeyUserId: payload.mkkeyUserId }, { mkkeyUsernameLower: payload.mkkeyUsernameLower }],
			relations: ['user'],
		});

		if (!link?.user) return null;
		return link.user as MiLocalUser;
	}

	public async saveLink(payload: { mkkeyUserId: string; mkkeyUsernameLower: string; userId: string; }): Promise<void> {
		await this.mkkeyAccountLinksRepository.insert({
			mkkeyUserId: payload.mkkeyUserId,
			mkkeyUsernameLower: payload.mkkeyUsernameLower,
			userId: payload.userId,
		});
	}

	public async signin(request: FastifyRequest<{ Body: { oauthToken: string; } }>, reply: FastifyReply) {
		const oauthToken = request.body.oauthToken;
		if (typeof oauthToken !== 'string' || oauthToken.length === 0) throw new FastifyReplyError(400, 'NO_MKKEY_OAUTH_TOKEN');

		const payload = this.verifyOauthToken(oauthToken);
		const user = await this.findLinkedUser(payload);
		if (!user) throw new FastifyReplyError(404, 'MKKEY_ACCOUNT_NOT_LINKED');

		return this.signinService.signin(request, reply, user);
	}
}
