/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Align legacy and fresh installations without removing saved content or indexes.
export class UpstreamSchemaAlignment1795129200001 {
	name = 'UpstreamSchemaAlignment1795129200001';

	async up(queryRunner) {
		// Older hand-written migrations allowed NULL where the models require defaults.
		await queryRunner.query(`UPDATE "meta" SET "remoteObjectStorageUseSSL" = true WHERE "remoteObjectStorageUseSSL" IS NULL`);
		await queryRunner.query(`UPDATE "meta" SET "remoteObjectStorageUseProxy" = true WHERE "remoteObjectStorageUseProxy" IS NULL`);
		await queryRunner.query(`UPDATE "note_draft" SET "hasEvent" = false WHERE "hasEvent" IS NULL`);
		await queryRunner.query(`UPDATE "note_draft" SET "disableRightClick" = false WHERE "disableRightClick" IS NULL`);
		await queryRunner.query(`UPDATE "note_draft" SET "eventMetadata" = '{"@context":"https://schema.org/","@type":"Event"}' WHERE "eventMetadata" IS NULL`);
		await queryRunner.query(`COMMENT ON COLUMN "abuse_report_resolver"."updatedAt" IS 'The updated date of the AbuseReportResolver.'`);
		await queryRunner.query(`COMMENT ON COLUMN "abuse_report_resolver"."expirationDate" IS 'The expiration date of the AbuseReportResolver'`);
		await queryRunner.query(`COMMENT ON COLUMN "event"."metadata" IS 'metadata object describing the event. Follows https://schema.org/Event'`);
		await queryRunner.query(`ALTER TABLE "event" ALTER COLUMN "metadata" SET DEFAULT '{"@context":"https://schema.org/","@type":"Event"}'`);
		await queryRunner.query(`ALTER TABLE "meta" ALTER COLUMN "remoteObjectStorageUseSSL" SET NOT NULL`);
		await queryRunner.query(`ALTER TABLE "meta" ALTER COLUMN "remoteObjectStorageUseProxy" SET NOT NULL`);
		await queryRunner.query(`COMMENT ON COLUMN "meta"."trustedLinkUrlPatterns" IS 'An array of URL strings or regex that can be used to omit warnings about redirects to external sites. Separate them with spaces to specify AND, and enclose them with slashes to specify regular expressions. Each item is regarded as an OR.'`);
		await queryRunner.query(`ALTER TABLE "meta" ALTER COLUMN "proxyRemoteFiles" SET DEFAULT true`);
		await queryRunner.query(`ALTER TABLE "note_draft" ALTER COLUMN "hasEvent" SET NOT NULL`);
		await queryRunner.query(`ALTER TABLE "note_draft" ALTER COLUMN "disableRightClick" SET NOT NULL`);
		await queryRunner.query(`COMMENT ON COLUMN "note_draft"."eventStart" IS 'The start time of the event'`);
		await queryRunner.query(`COMMENT ON COLUMN "note_draft"."eventEnd" IS 'The end of the event'`);
		await queryRunner.query(`COMMENT ON COLUMN "note_draft"."eventTitle" IS 'short name of event'`);
		await queryRunner.query(`ALTER TABLE "note_draft" ALTER COLUMN "eventMetadata" SET NOT NULL`);
		await queryRunner.query(`COMMENT ON COLUMN "note_draft"."eventMetadata" IS 'metadata object describing the event. Follows https://schema.org/Event'`);
		await queryRunner.query(`ALTER TABLE "note_draft" ALTER COLUMN "eventMetadata" SET DEFAULT '{"@context":"https://schema.org/","@type":"Event"}'`);
		await queryRunner.query(`CREATE INDEX "IDX_3fcc2c589eaefc205e0714b99c" ON "ad" ("startsAt")`);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_c71faf11f0a28a5c0bb506203c" ON "channel_favorite" ("userId", "channelId")`);
		await queryRunner.query(`CREATE INDEX "IDX_72689e25ff8131746cb31ef9a1" ON "note_draft" ("eventStart")`);
		await queryRunner.query(`CREATE INDEX "IDX_7eac97594bcac5ffcf2068089b" ON "renote_muting" ("muteeId")`);
		await queryRunner.query(`CREATE INDEX "IDX_7aa72a5fe76019bfe8e5e0e8b7" ON "renote_muting" ("muterId")`);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_0d801c609cec4e9eb4b6b4490c" ON "renote_muting" ("muterId", "muteeId")`);
		await queryRunner.query(`ALTER TABLE "renote_muting" ADD CONSTRAINT "FK_7eac97594bcac5ffcf2068089b6" FOREIGN KEY ("muteeId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
		await queryRunner.query(`ALTER TABLE "renote_muting" ADD CONSTRAINT "FK_7aa72a5fe76019bfe8e5e0e8b7d" FOREIGN KEY ("muterId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
	}

	async down(queryRunner) {
		await queryRunner.query(`COMMENT ON COLUMN "abuse_report_resolver"."updatedAt" IS 'The updated date of AbuseReportResolver'`);
		await queryRunner.query(`COMMENT ON COLUMN "abuse_report_resolver"."expirationDate" IS 'The expiration date of AbuseReportResolver'`);
		await queryRunner.query(`COMMENT ON COLUMN "event"."metadata" IS 'metadata mapping for event with more user configurable optional information'`);
		await queryRunner.query(`ALTER TABLE "event" ALTER COLUMN "metadata" SET DEFAULT '{}'`);
		await queryRunner.query(`ALTER TABLE "meta" ALTER COLUMN "remoteObjectStorageUseSSL" DROP NOT NULL`);
		await queryRunner.query(`ALTER TABLE "meta" ALTER COLUMN "remoteObjectStorageUseProxy" DROP NOT NULL`);
		await queryRunner.query(`COMMENT ON COLUMN "meta"."trustedLinkUrlPatterns" IS NULL`);
		await queryRunner.query(`ALTER TABLE "meta" ALTER COLUMN "proxyRemoteFiles" SET DEFAULT false`);
		await queryRunner.query(`ALTER TABLE "note_draft" ALTER COLUMN "hasEvent" DROP NOT NULL`);
		await queryRunner.query(`ALTER TABLE "note_draft" ALTER COLUMN "disableRightClick" DROP NOT NULL`);
		await queryRunner.query(`COMMENT ON COLUMN "note_draft"."eventStart" IS NULL`);
		await queryRunner.query(`COMMENT ON COLUMN "note_draft"."eventEnd" IS NULL`);
		await queryRunner.query(`COMMENT ON COLUMN "note_draft"."eventTitle" IS NULL`);
		await queryRunner.query(`ALTER TABLE "note_draft" ALTER COLUMN "eventMetadata" DROP NOT NULL`);
		await queryRunner.query(`COMMENT ON COLUMN "note_draft"."eventMetadata" IS NULL`);
		await queryRunner.query(`ALTER TABLE "note_draft" ALTER COLUMN "eventMetadata" SET DEFAULT '{}'`);
		await queryRunner.query(`DROP INDEX "public"."IDX_3fcc2c589eaefc205e0714b99c"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_c71faf11f0a28a5c0bb506203c"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_72689e25ff8131746cb31ef9a1"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_7eac97594bcac5ffcf2068089b"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_7aa72a5fe76019bfe8e5e0e8b7"`);
		await queryRunner.query(`DROP INDEX "public"."IDX_0d801c609cec4e9eb4b6b4490c"`);
		await queryRunner.query(`ALTER TABLE "renote_muting" DROP CONSTRAINT "FK_7eac97594bcac5ffcf2068089b6"`);
		await queryRunner.query(`ALTER TABLE "renote_muting" DROP CONSTRAINT "FK_7aa72a5fe76019bfe8e5e0e8b7d"`);
	}
}
