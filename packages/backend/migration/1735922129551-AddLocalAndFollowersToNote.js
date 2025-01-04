/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddLocalAndFollowersToNote1735922129551 {
    name = 'AddLocalAndFollowersToNote1735922129551'

    async up(queryRunner) {
			await queryRunner.query('ALTER TABLE "note" ADD "localAndFollowers" boolean NOT NULL DEFAULT false');
    }

    async down(queryRunner) {
			await queryRunner.query('ALTER TABLE "note" DROP COLUMN "localAndFollowers"');
    }
}
