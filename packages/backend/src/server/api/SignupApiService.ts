/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
//import bcrypt from 'bcryptjs';
import * as argon2 from 'argon2';
import { IsNull } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { RegistrationTicketsRepository, UsedUsernamesRepository, UserPendingsRepository, UserProfilesRepository, UsersRepository, MiRegistrationTicket, MiMeta } from '@/models/_.js';
import type { Config } from '@/config.js';
import { CaptchaService } from '@/core/CaptchaService.js';
import { IdService } from '@/core/IdService.js';
import { SignupService } from '@/core/SignupService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { EmailService } from '@/core/EmailService.js';
import { MiLocalUser } from '@/models/User.js';
import { FastifyReplyError } from '@/misc/fastify-reply-error.js';
import { isDuplicateKeyValueError } from '@/misc/is-duplicate-key-value-error.js';
import { bindThis } from '@/decorators.js';
import { L_CHARS, secureRndstr } from '@/misc/secure-rndstr.js';
import { SigninService } from './SigninService.js';
import { MkkeySsoApiService } from './MkkeySsoApiService.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

@Injectable()
export class SignupApiService {
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.userPendingsRepository)
		private userPendingsRepository: UserPendingsRepository,

		@Inject(DI.usedUsernamesRepository)
		private usedUsernamesRepository: UsedUsernamesRepository,

		@Inject(DI.registrationTicketsRepository)
		private registrationTicketsRepository: RegistrationTicketsRepository,

		private userEntityService: UserEntityService,
		private idService: IdService,
		private captchaService: CaptchaService,
		private signupService: SignupService,
		private signinService: SigninService,
		private mkkeySsoApiService: MkkeySsoApiService,
		private emailService: EmailService,
	) {
	}

	@bindThis
	public async signup(
		request: FastifyRequest<{
			Body: {
				username: string;
				password: string;
				host?: string;
				invitationCode?: string;
				emailAddress?: string;
				mkkeyOauthToken?: string;
				'hcaptcha-response'?: string;
				'g-recaptcha-response'?: string;
				'turnstile-response'?: string;
				'm-captcha-response'?: string;
				'testcaptcha-response'?: string;
			}
		}>,
		reply: FastifyReply,
	) {
		const body = request.body;
		if (!body || typeof body !== 'object' || Array.isArray(body)) throw new FastifyReplyError(400, 'INVALID_REQUEST');

		if (process.env.NODE_ENV !== 'test') {
			if (this.meta.enableHcaptcha && this.meta.hcaptchaSecretKey) {
				await this.captchaService.verifyHcaptcha(this.meta.hcaptchaSecretKey, body['hcaptcha-response']).catch(err => {
					throw new FastifyReplyError(400, err);
				});
			}

			if (this.meta.enableMcaptcha && this.meta.mcaptchaSecretKey && this.meta.mcaptchaSitekey && this.meta.mcaptchaInstanceUrl) {
				await this.captchaService.verifyMcaptcha(this.meta.mcaptchaSecretKey, this.meta.mcaptchaSitekey, this.meta.mcaptchaInstanceUrl, body['m-captcha-response']).catch(err => {
					throw new FastifyReplyError(400, err);
				});
			}

			if (this.meta.enableRecaptcha && this.meta.recaptchaSecretKey) {
				await this.captchaService.verifyRecaptcha(this.meta.recaptchaSecretKey, body['g-recaptcha-response']).catch(err => {
					throw new FastifyReplyError(400, err);
				});
			}

			if (this.meta.enableTurnstile && this.meta.turnstileSecretKey) {
				await this.captchaService.verifyTurnstile(this.meta.turnstileSecretKey, body['turnstile-response']).catch(err => {
					throw new FastifyReplyError(400, err);
				});
			}

			if (this.meta.enableTestcaptcha) {
				await this.captchaService.verifyTestcaptcha(body['testcaptcha-response']).catch(err => {
					throw new FastifyReplyError(400, err);
				});
			}
		}

		const username = body['username'];
		const password = body['password'];
		const host: string | null = process.env.NODE_ENV === 'test' ? (body['host'] ?? null) : null;
		const invitationCode = body['invitationCode'];
		const emailAddress = body['emailAddress'];
		const mkkeyOauthToken = body['mkkeyOauthToken'];
		if (typeof username !== 'string' || !this.userEntityService.validateLocalUsername(username)) throw new FastifyReplyError(400, 'INVALID_USERNAME');
		if (typeof password !== 'string' || !this.userEntityService.validatePassword(password)) throw new FastifyReplyError(400, 'INVALID_PASSWORD');

		const mkkeyIdentity = typeof mkkeyOauthToken === 'string' && mkkeyOauthToken.length > 0
			? await this.mkkeySsoApiService.verifyOauthToken(mkkeyOauthToken, request)
			: null;

		if (this.meta.emailRequiredForSignup) {
			if (emailAddress == null || typeof emailAddress !== 'string') {
				reply.code(400);
				return;
			}

			const res = await this.emailService.validateEmailForAccount(emailAddress);
			if (!res.available) {
				reply.code(400);
				return;
			}
		}

		let ticket: MiRegistrationTicket | null = null;

		if (process.env.NODE_ENV !== 'test' && this.meta.disableRegistration) {
			if ((invitationCode == null || typeof invitationCode !== 'string') && !mkkeyIdentity) {
				reply.code(400);
				return;
			}

			if (!mkkeyIdentity && invitationCode != null && typeof invitationCode === 'string') {
				ticket = await this.registrationTicketsRepository.findOneBy({
					code: invitationCode,
				});
			}

			if (!mkkeyIdentity) {
				if (ticket == null || ticket.usedById != null) {
					reply.code(400);
					return;
				}
			}

			if (ticket && ticket.expiresAt && ticket.expiresAt < new Date()) {
				reply.code(400);
				return;
			}

			if (ticket && this.meta.emailRequiredForSignup) {
				if (ticket.usedBy) {
					reply.code(400);
					return;
				}

				if (ticket.usedAt && ticket.usedAt.getTime() + (1000 * 60 * 30) > Date.now()) {
					reply.code(400);
					return;
				}
			} else if (ticket && ticket.usedAt) {
				reply.code(400);
				return;
			}
		}

		if (this.meta.emailRequiredForSignup) {
			if (await this.usersRepository.exists({ where: { usernameLower: username.toLowerCase(), host: IsNull() } })) {
				throw new FastifyReplyError(400, 'DUPLICATED_USERNAME');
			}

			if (await this.usedUsernamesRepository.exists({ where: { username: username.toLowerCase() } })) {
				throw new FastifyReplyError(400, 'USED_USERNAME');
			}

			const isPreserved = this.meta.preservedUsernames.map(x => x.toLowerCase()).includes(username.toLowerCase());
			if (isPreserved) {
				throw new FastifyReplyError(400, 'DENIED_USERNAME');
			}

			if (mkkeyIdentity) {
				const pending = await this.userPendingsRepository.findOneBy({ mkkeyUserId: mkkeyIdentity.mkkeyUserId });
				if (pending) {
					if (this.idService.parse(pending.id).date.getTime() + 30 * 60 * 1000 >= Date.now()) throw new FastifyReplyError(409, 'MKKEY_SIGNUP_PENDING');
					await this.userPendingsRepository.delete({ id: pending.id });
				}
			}
			const code = secureRndstr(16, { chars: L_CHARS });
			const hash = await argon2.hash(password);

			if (mkkeyIdentity) await this.mkkeySsoApiService.consumeSignupProof(mkkeyOauthToken!, request);

			const pendingUser = await this.userPendingsRepository.insertOne({
				id: this.idService.gen(),
				code,
				email: emailAddress!,
				username,
				password: hash,
				mkkeyUserId: mkkeyIdentity?.mkkeyUserId ?? null,
				mkkeyUsernameLower: mkkeyIdentity?.mkkeyUsernameLower ?? null,
			}).catch((error: unknown) => {
				if (mkkeyIdentity && isDuplicateKeyValueError(error)) throw new FastifyReplyError(409, 'MKKEY_SIGNUP_PENDING');
				throw error;
			});

			const link = `${this.config.url}/signup-complete/${code}`;

			this.emailService.sendEmail(emailAddress!, 'Signup',
				`To complete signup, please click this link:<br><a href="${link}">${link}</a>`,
				`To complete signup, please click this link: ${link}`);

			if (ticket) {
				await this.registrationTicketsRepository.update(ticket.id, {
					usedAt: new Date(),
					pendingUserId: pendingUser.id,
				});
			}

			reply.code(204);
			return;
		}

		if (mkkeyIdentity) await this.mkkeySsoApiService.consumeSignupProof(mkkeyOauthToken!, request);
		try {
			const { account, secret } = await this.signupService.signup({
				username, password, host, mkkeyIdentity,
			});

			const res = await this.userEntityService.pack(account, account, {
				schema: 'MeDetailed',
				includeSecrets: true,
			});

			if (ticket) {
				await this.registrationTicketsRepository.update(ticket.id, {
					usedAt: new Date(),
					usedBy: account,
					usedById: account.id,
				});
			}

			return {
				...res,
				token: secret,
			};
		} catch (err) {
			throw new FastifyReplyError(400, typeof err === 'string' ? err : (err as Error).toString());
		}
	}

	@bindThis
	public async signupPending(request: FastifyRequest<{ Body: { code: string; } }>, reply: FastifyReply) {
		const body = request.body;
		const code = body['code'];

		try {
			const pendingUser = await this.userPendingsRepository.findOneByOrFail({ code });

			if (this.idService.parse(pendingUser.id).date.getTime() + (1000 * 60 * 30) < Date.now()) {
				throw new FastifyReplyError(400, 'EXPIRED');
			}

			const { account } = await this.signupService.signup({
				username: pendingUser.username,
				passwordHash: pendingUser.password,
				pendingUserId: pendingUser.id,
				verifiedEmail: pendingUser.email,
				mkkeyIdentity: pendingUser.mkkeyUserId ? { mkkeyUserId: pendingUser.mkkeyUserId, mkkeyUsernameLower: pendingUser.mkkeyUsernameLower ?? '' } : null,
			});

			const ticket = await this.registrationTicketsRepository.findOneBy({ pendingUserId: pendingUser.id });
			if (ticket) {
				await this.registrationTicketsRepository.update(ticket.id, {
					usedBy: account,
					usedById: account.id,
					pendingUserId: null,
				});
			}

			return this.signinService.signin(request, reply, account as MiLocalUser);
		} catch (err) {
			throw new FastifyReplyError(400, typeof err === 'string' ? err : (err as Error).toString());
		}
	}
}
