import { Inject, Injectable } from "@nestjs/common";
import { Job } from "bullmq";
import { DI } from "@/di";
import { Logger } from "winston";
import { QueueProcessor } from "../QueueProcessor.js";
import { EmojiSyncService } from "@/core/EmojiSyncService.js";

type SyncEmojisJobData = {};

@Injectable()
export class SyncEmojisProcessorService extends QueueProcessor<SyncEmojisJobData> {
	constructor(
    @Inject(DI.Logger)
    private readonly rootLogger: Logger,
    @Inject(DI.EmojiSyncService)
    private readonly emojiSyncService: EmojiSyncService,
  ) {
    super();
    this.logger = this.rootLogger.child({ service: 'SyncEmojisProcessorService' });
  }

	async process(): Promise<void> {
		this.logger.info(`Processing job : Syncing emojis...`);
		await this.emojiSyncService.syncEmojis();
		this.logger.info(`Job completed: Emojis synced.`);
	}
}
