/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class LocalRelaySubscriber1795061000000 {
	name = 'LocalRelaySubscriber1795061000000';
	async up(queryRunner) {
		await queryRunner.query('CREATE TABLE "local_relay_subscriber" ("userId" character varying(32) NOT NULL, "followId" character varying(2048) NOT NULL, CONSTRAINT "PK_local_relay_subscriber" PRIMARY KEY ("userId"), CONSTRAINT "FK_local_relay_subscriber_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE)');
	}
	async down(queryRunner) {
		await queryRunner.query('DROP TABLE "local_relay_subscriber"');
	}
}
