/*
 * SPDX-FileCopyrightText: noridev and cherrypick-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class RemoveNoteEditHistory1761583921158 {
	name = 'RemoveNoteEditHistory1761583921158';

	async up(queryRunner) {
		// Preserve pre-4.17 history. CW and text were stored together, so converting
		// these strings into structured revisions would invent missing information.
		await queryRunner.query('ALTER TABLE "note" ADD COLUMN IF NOT EXISTS "noteEditHistory" character varying(3000) array NOT NULL DEFAULT \'{}\'');
	}

	async down(queryRunner) {
		// The preserved column is also used by older versions.
	}
}
