/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class LocalRealmDraftVisibility1795129200000 {
	name = 'LocalRealmDraftVisibility1795129200000';

	async up(queryRunner) {
		await queryRunner.query('ALTER TABLE "note_draft" ADD "localAndFollowers" boolean NOT NULL DEFAULT false');
	}

	async down(queryRunner) {
		await queryRunner.query('ALTER TABLE "note_draft" DROP COLUMN "localAndFollowers"');
	}
}
