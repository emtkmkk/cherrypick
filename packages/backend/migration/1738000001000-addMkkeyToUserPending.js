/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddMkkeyToUserPending1738000001000 {
	name = 'AddMkkeyToUserPending1738000001000'

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "user_pending" ADD "mkkeyUserId" character varying(128)`);
		await queryRunner.query(`ALTER TABLE "user_pending" ADD "mkkeyUsernameLower" character varying(128)`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "user_pending" DROP COLUMN "mkkeyUsernameLower"`);
		await queryRunner.query(`ALTER TABLE "user_pending" DROP COLUMN "mkkeyUserId"`);
	}
}
