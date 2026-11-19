/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Brackets } from 'typeorm';
import { Inject, Injectable } from '@nestjs/common';
import type { MiMeta, NotesRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import ActiveUsersChart from '@/core/chart/charts/active-users.js';
import { DI } from '@/di-symbols.js';
import { RoleService } from '@/core/RoleService.js';
import { IdService } from '@/core/IdService.js';
import { QueryService } from '@/core/QueryService.js';
import { CacheService } from '@/core/CacheService.js';
import { MiLocalUser } from '@/models/User.js';
import { FanoutTimelineEndpointService } from '@/core/FanoutTimelineEndpointService.js';
import { ApiError } from '../../error.js';

export const meta = {
	tags: ['notes'],

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'Note',
		},
	},

	errors: {
		ltlDisabled: {
			message: 'Local timeline has been disabled.',
			code: 'LTL_DISABLED',
			id: '45a6eb02-7695-4393-b023-dd3be9aaaefd',
		},

		bothWithRepliesAndWithFiles: {
			message: 'Specifying both withReplies and withFiles is not supported',
			code: 'BOTH_WITH_REPLIES_AND_WITH_FILES',
			id: 'dd9c8400-1cb5-4eef-8a31-200c5f933793',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		withFiles: { type: 'boolean', default: false },
		withRenotes: { type: 'boolean', default: true },
		withReplies: { type: 'boolean', default: false },
		withCats: { type: 'boolean', default: false },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
		allowPartial: { type: 'boolean', default: false }, // true is recommended but for compatibility false by default
		sinceDate: { type: 'integer' },
		untilDate: { type: 'integer' },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meta)
		private serverSettings: MiMeta,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		private noteEntityService: NoteEntityService,
		private roleService: RoleService,
		private activeUsersChart: ActiveUsersChart,
		private idService: IdService,
		private fanoutTimelineEndpointService: FanoutTimelineEndpointService,
		private queryService: QueryService,
		private cacheService: CacheService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const untilId = ps.untilId ?? (ps.untilDate ? this.idService.gen(ps.untilDate!) : null);
			const sinceId = ps.sinceId ?? (ps.sinceDate ? this.idService.gen(ps.sinceDate!) : null);

			const policies = await this.roleService.getUserPolicies(me ? me.id : null);
			if (!policies.ltlAvailable) {
				throw new ApiError(meta.errors.ltlDisabled);
			}

			if (ps.withReplies && ps.withFiles) throw new ApiError(meta.errors.bothWithRepliesAndWithFiles);

			// The local Redis lists contain only local authors. Query the configured
			// bubble directly so remote and pre-existing notes are never omitted.
			if (!this.serverSettings.enableFanoutTimeline || this.serverSettings.bubbleInstances.length > 0) {
				const timeline = await this.getFromDb({
					untilId,
					sinceId,
					limit: ps.limit,
					withFiles: ps.withFiles,
					withReplies: ps.withReplies,
					withRenotes: ps.withRenotes,
					withCats: ps.withCats,
				}, me);

				process.nextTick(() => {
					if (me) {
						this.activeUsersChart.read(me);
					}
				});

				return await this.noteEntityService.packMany(timeline, me);
			}

			const timeline = await this.fanoutTimelineEndpointService.timeline({
				untilId,
				sinceId,
				limit: ps.limit,
				allowPartial: ps.allowPartial,
				me,
				useDbFallback: this.serverSettings.enableFanoutTimelineDbFallback,
				redisTimelines:
					ps.withFiles ? ['localTimelineWithFiles']
					: ps.withReplies ? ['localTimeline', 'localTimelineWithReplies']
					: me ? ['localTimeline', `localTimelineWithReplyTo:${me.id}`]
					: ['localTimeline'],
				alwaysIncludeMyNotes: true,
				excludePureRenotes: !ps.withRenotes,
				withCats: ps.withCats,
				dbFallback: async (untilId, sinceId, limit) => await this.getFromDb({
					untilId,
					sinceId,
					limit,
					withFiles: ps.withFiles,
					withReplies: ps.withReplies,
					withRenotes: ps.withRenotes,
					withCats: ps.withCats,
				}, me),
			});

			process.nextTick(() => {
				if (me) {
					this.activeUsersChart.read(me);
				}
			});

			return timeline;
		});
	}

	private async getFromDb(ps: {
		sinceId: string | null,
		untilId: string | null,
		limit: number,
		withFiles: boolean,
		withReplies: boolean,
		withRenotes: boolean,
		withCats: boolean,
	}, me: MiLocalUser | null) {
		const followings = me ? await this.cacheService.userFollowingsCache.fetch(me.id) : undefined;
		const query = this.queryService.makePaginationQuery(this.notesRepository.createQueryBuilder('note'),
			ps.sinceId, ps.untilId)
			.andWhere('(note.visibility = \'public\') AND (note.channelId IS NULL)')
			.andWhere('(note.userHost IS NULL OR note.userHost = ANY(:bubbleHosts))', { bubbleHosts: this.serverSettings.bubbleInstances })
			.innerJoinAndSelect('note.user', 'user')
			.leftJoinAndSelect('note.reply', 'reply')
			.leftJoinAndSelect('note.renote', 'renote')
			.leftJoinAndSelect('reply.user', 'replyUser')
			.leftJoinAndSelect('renote.user', 'renoteUser');
		if (this.serverSettings.bubbleInstances.length > 0) {
			query.andWhere('(note.replyId IS NULL OR reply.userHost IS NULL OR reply.userHost = ANY(:bubbleHosts))');
		}

		this.queryService.generateVisibilityQuery(query, me);
		if (me) this.queryService.generateMutedUserQuery(query, me);
		if (me) this.queryService.generateBlockedUserQuery(query, me);
		if (me) this.queryService.generateMutedUserRenotesQueryForNotes(query, me);

		if (me == null) query.andWhere('note.localAndFollowers = false');

		if (ps.withFiles) {
			query.andWhere('note.fileIds != \'{}\'');
		}

		if (!ps.withReplies) {
			query.andWhere(new Brackets(qb => {
				qb
					.where('note.replyId IS NULL') // 返信ではない
					.orWhere(new Brackets(qb => {
						qb // 返信だけど投稿者自身への返信
							.where('note.replyId IS NOT NULL')
							.andWhere('note.replyUserId = note.userId');
					}));
				if (me) {
					qb.orWhere('note.userId = :localTimelineMeId OR note.replyUserId = :localTimelineMeId', { localTimelineMeId: me.id });
					const withReplyUserIds = Object.keys(followings ?? {}).filter(id => followings?.[id]?.withReplies);
					if (withReplyUserIds.length > 0) qb.orWhere('note.userId IN (:...withReplyUserIds)', { withReplyUserIds });
				}
			}));
		}

		if (!ps.withRenotes) {
			query.andWhere('(note.renoteId IS NULL OR note.text IS NOT NULL OR note.fileIds != \'{}\')');
		}

		if (ps.withCats) {
			query.andWhere('(select "isCat" from "user" where id = note."userId")');
		}

		let timeline = await query.limit(ps.limit).getMany();
		if (me && followings) {
			const visible = await Promise.all(timeline.map(async note =>
				note.userId === me.id || !!followings[note.userId] || (await this.roleService.getUserPolicies(note.userId)).canPublicNote));
			timeline = timeline.filter((_, index) => visible[index]);
		}
		return timeline;
	}
}
