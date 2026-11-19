/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class HardenMkkeyAccountLinks1795060000000 {
	name = 'HardenMkkeyAccountLinks1795060000000';

	async up(queryRunner) {
		await queryRunner.query('DROP INDEX IF EXISTS "IDX_mkkey_account_link_mkkey_username_lower"');
		await queryRunner.query('CREATE UNIQUE INDEX "IDX_user_pending_mkkey_user_id" ON "user_pending" ("mkkeyUserId")');
	}

	async down(queryRunner) {
		await queryRunner.query('DROP INDEX "IDX_user_pending_mkkey_user_id"');
		await queryRunner.query('CREATE UNIQUE INDEX "IDX_mkkey_account_link_mkkey_username_lower" ON "mkkey_account_link" ("mkkeyUsernameLower")');
	}
}
