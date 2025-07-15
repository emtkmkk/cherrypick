import { Inject, Injectable } from "@nestjs/common";
import type Logger from '@/logger.js';
import { QueueLoggerService } from '../QueueLoggerService.js';
import { EmojiSyncService } from "@/core/EmojiSyncService.js";
import { bindThis } from '@/decorators.js';

@Injectable()
export class SyncEmojisProcessorService {
	private logger: Logger;

	constructor(
		private queueLoggerService: QueueLoggerService,
		private emojiSyncService: EmojiSyncService,
  ) {
		this.logger = this.queueLoggerService.logger.createSubLogger('syncEmoji');
  }

	@bindThis
	public async process(): Promise<void> {
		this.logger.info(`Processing job : Syncing emojis...`);
		await this.emojiSyncService.syncEmojis();
		this.logger.info(`Job completed: Emojis synced.`);
	}
}
