import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import { MiEmoji } from '@/models/Emoji.js';
import type { EmojisRepository } from '@/models/_.js';
import { HttpRequestService } from './HttpRequestService.js';
import Logger from '@/logger.js';
import { bindThis } from '@/decorators.js';
import { IsNull } from 'typeorm';

// リモート絵文字のインターフェース定義
interface RemoteEmoji {
  id: string;
  aliases: string[];
  name: string;
  category: string | null;
  host: string | null;
  url: string;
  license: string | null;
  createdAt: string;
  updatedAt: string;
}

interface emojiApi {
	emojis: RemoteEmoji[]
}

@Injectable()
export class EmojiSyncService implements OnApplicationShutdown {
  private readonly logger: Logger;

  constructor(
    @Inject(DI.emojisRepository)
    private readonly emojisRepository: EmojisRepository,
    private httpRequestService: HttpRequestService,
  ) {
		this.logger = new Logger('emojiSync', 'blue');
  }

  /**
   * 絵文字の同期処理を実行します。
   * リモートAPIから絵文字を取得し、追加、更新、削除を行います。
   * APIアクセスに失敗した場合は、何も変更せずに処理を終了します。
   */
	@bindThis
  async syncEmojis() {
    this.logger.info('絵文字の同期を開始します...');
    try {
      const remoteEmojis: RemoteEmoji[] = (await this.httpRequestService.getJson<emojiApi>('https://mkkey.net/api/emojis', 'application/json, */*', undefined, false, 25 * 1024 * 1024))?.emojis;

      if (!Array.isArray(remoteEmojis)) {
        this.logger.error('リモート絵文字の取得に失敗しました: 期待される配列形式ではありません。');
        return;
      }

      // 既存のmkkey.netの絵文字を取得
      const existingEmojis = await this.emojisRepository.find({ where: { host: IsNull() } });
      const existingEmojiMap = new Map<string, MiEmoji>(existingEmojis.map(e => [e.name, e]));
      const remoteEmojiMap = new Map<string, RemoteEmoji>(remoteEmojis.map(e => [e.name, e]));

      // 絵文字の追加または更新
      for (const remoteEmoji of remoteEmojis) {
        const existingEmoji = existingEmojiMap.get(remoteEmoji.name);

        if (existingEmoji) {
          // 既存の絵文字がある場合、プロパティが異なる場合は更新
          const updatedFields: Partial<MiEmoji> = {};
          let changed = false;

          if (existingEmoji.originalUrl !== remoteEmoji.url) {
            updatedFields.originalUrl = remoteEmoji.url;
            updatedFields.publicUrl = remoteEmoji.url; // 直リンクを使用
            changed = true;
          }
          if (existingEmoji.category !== remoteEmoji.category) {
            updatedFields.category = remoteEmoji.category;
            changed = true;
          }
          // エイリアスの比較はソートしてから行う
          if (JSON.stringify(existingEmoji.aliases.sort()) !== JSON.stringify(remoteEmoji.aliases.sort())) {
            updatedFields.aliases = remoteEmoji.aliases;
            changed = true;
          }
          if (existingEmoji.license !== remoteEmoji.license) {
            updatedFields.license = remoteEmoji.license;
            changed = true;
          }
          const newIsSensitive = remoteEmoji.aliases.includes('センシティブ');
          if (existingEmoji.isSensitive !== newIsSensitive) {
            updatedFields.isSensitive = newIsSensitive;
            changed = true;
          }

          if (changed) {
            await this.emojisRepository.update(existingEmoji.id, { ...updatedFields, updatedAt: new Date() });
            this.logger.info(`絵文字を更新しました: ${remoteEmoji.name}`);
          }
        } else {
          // 新しい絵文字を追加
          await this.emojisRepository.insertOne({
            id: remoteEmoji.id,
            updatedAt: new Date(),
            name: remoteEmoji.name,
            host: null,
            category: remoteEmoji.category,
            originalUrl: remoteEmoji.url,
            publicUrl: remoteEmoji.url,
            type: null, // Type is not provided by the remote API, setting to null
            aliases: remoteEmoji.aliases,
            license: remoteEmoji.license,
            isSensitive: remoteEmoji.aliases.includes('センシティブ'),
            localOnly: false,
            roleIdsThatCanBeUsedThisEmojiAsReaction: [],
          });
          this.logger.info(`新しい絵文字を追加しました: ${remoteEmoji.name}`);
        }
      }

      // リモートに存在しない絵文字を削除
      for (const existingEmoji of existingEmojis) {
        if (!remoteEmojiMap.has(existingEmoji.name)) {
          await this.emojisRepository.delete(existingEmoji.id);
          this.logger.info(`絵文字を削除しました: ${existingEmoji.name}`);
        }
      }

      this.logger.info('絵文字の同期が完了しました。');
    } catch (error: any) {
      this.logger.error(`絵文字の同期に失敗しました: ${error.message}`);
      // APIアクセス失敗時は何も変更しないため、ここで処理を終了
    }
  }
}
