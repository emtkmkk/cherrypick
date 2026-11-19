/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class MkkeyAccountLink1738000000000 {
	name = 'MkkeyAccountLink1738000000000'

	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE "mkkey_account_link" ("id" SERIAL NOT NULL, "mkkeyUserId" character varying(128) NOT NULL, "mkkeyUsernameLower" character varying(128) NOT NULL, "userId" character varying(32) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_08defe7f3936a8058bc2a9993c8" PRIMARY KEY ("id"))`);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_mkkey_account_link_mkkey_user_id" ON "mkkey_account_link" ("mkkeyUserId") `);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_mkkey_account_link_mkkey_username_lower" ON "mkkey_account_link" ("mkkeyUsernameLower") `);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_mkkey_account_link_user_id" ON "mkkey_account_link" ("userId") `);
		await queryRunner.query(`ALTER TABLE "mkkey_account_link" ADD CONSTRAINT "FK_mkkey_account_link_user_id" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "mkkey_account_link" DROP CONSTRAINT "FK_mkkey_account_link_user_id"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_mkkey_account_link_user_id"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_mkkey_account_link_mkkey_username_lower"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_mkkey_account_link_mkkey_user_id"`);
		await queryRunner.query(`DROP TABLE "mkkey_account_link"`);
	}
}
