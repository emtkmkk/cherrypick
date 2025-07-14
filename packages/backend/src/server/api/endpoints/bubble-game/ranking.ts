/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { BubbleGameRecordsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';

export const meta = {
	allowGet: true,
	cacheSec: 60,

	errors: {
	},

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			properties: {
				id: {
					type: 'string', format: 'misskey:id',
					optional: false, nullable: false,
				},
				score: {
					type: 'integer',
					optional: false, nullable: false,
				},
				user: {
					type: 'object',
					optional: true, nullable: false,
					ref: 'UserLite',
				},
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		gameMode: { type: 'string' },
	},
	required: ['gameMode'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.bubbleGameRecordsRepository)
		private bubbleGameRecordsRepository: BubbleGameRecordsRepository,

		private userEntityService: UserEntityService,
	) {
		super(meta, paramDef, async (ps) => {
                        const raw = await this.bubbleGameRecordsRepository.createQueryBuilder('record')
                                .select('record.userId', 'userId')
                                .addSelect('MAX(record.score)', 'score')
                                .where('record.gameMode = :gameMode', { gameMode: ps.gameMode })
                                .groupBy('record.userId')
                                .orderBy('score', 'DESC')
                                .limit(10)
                                .getRawMany<{ userId: string; score: string }>();

                        const users = await this.userEntityService.packMany(raw.map(r => r.userId), null);

                        return raw.map(r => ({
                                id: r.userId,
                                score: parseInt(r.score, 10),
                                user: users.find(u => u.id === r.userId),
                        }));
		});
	}
}
