/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { MiEmoji } from '@/models/Emoji.js';
import type { EmojisRepository } from '@/models/_.js';
import { HttpRequestService } from './HttpRequestService.js';
import Logger from '@/logger.js';
import { bindThis } from '@/decorators.js';
import { IsNull } from 'typeorm';
import { CustomEmojiService } from './CustomEmojiService.js';
import { EmojiEntityService } from './entities/EmojiEntityService.js';
import { GlobalEventService } from './GlobalEventService.js';

// リモート絵文字のインターフェース定義
interface RemoteEmoji {
  id: string;
  aliases: string[];
  name: string;
  category?: string | null;
  host?: string | null;
  url: string;
  license?: string | null;
  usageVisibility?: string | null;
  motifUserId?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface EmojiApi {
	emojis: RemoteEmoji[]
}

@Injectable()
export class EmojiSyncService {
  private readonly logger: Logger;

  constructor(
    @Inject(DI.emojisRepository)
    private readonly emojisRepository: EmojisRepository,
    private httpRequestService: HttpRequestService,
    private customEmojiService: CustomEmojiService,
    private emojiEntityService: EmojiEntityService,
    private globalEventService: GlobalEventService,
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
      const remoteEmojis: RemoteEmoji[] = (await this.httpRequestService.getJson<EmojiApi>('https://mkkey.net/api/emojis', 'application/json, */*', undefined, false, 25 * 1024 * 1024))?.emojis;

      if (!Array.isArray(remoteEmojis)) {
        this.logger.error('リモート絵文字の取得に失敗しました: 期待される配列形式ではありません。');
        return;
      }

      // 書き込み前に応答全体を検証する。不正な一覧を削除判定に使わない。
      if (!remoteEmojis.every(e => e != null && typeof e.id === 'string' &&
        typeof e.name === 'string' && typeof e.url === 'string' &&
        Array.isArray(e.aliases) && e.aliases.every(alias => typeof alias === 'string'))) {
        this.logger.error('リモート絵文字の取得に失敗しました: 不正な絵文字データです。');
        return;
      }

      // mkkey の API は public と null の項目を省略する。
      // モチーフは利用範囲が any でも、ユーザーが設定されていれば同期しない。
      const eligibleEmojis = remoteEmojis.filter(e => e.host == null &&
        (e.usageVisibility ?? 'public') === 'public' && e.motifUserId == null);

      // 既存のmkkey.netの絵文字を取得
      const existingEmojis = await this.emojisRepository.find({ where: { host: IsNull() } });
      const existingEmojiMap = new Map<string, MiEmoji>(existingEmojis.map(e => [e.name, e]));
      const remoteEmojiMap = new Map<string, RemoteEmoji>(eligibleEmojis.map(e => [e.name, e]));
      const addedIds: string[] = [];
      const updatedIds: string[] = [];

      // 絵文字の追加または更新
      for (const remoteEmoji of eligibleEmojis) {
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
          if (existingEmoji.category !== (remoteEmoji.category ?? null)) {
            updatedFields.category = remoteEmoji.category ?? null;
            changed = true;
          }
          // エイリアスの比較はソートしてから行う
          if (JSON.stringify([...existingEmoji.aliases].sort()) !== JSON.stringify([...remoteEmoji.aliases].sort())) {
            updatedFields.aliases = remoteEmoji.aliases;
            changed = true;
          }
          if (existingEmoji.license !== (remoteEmoji.license ?? null)) {
            updatedFields.license = remoteEmoji.license ?? null;
            changed = true;
          }
          const newIsSensitive = remoteEmoji.aliases.includes('センシティブ');
          if (existingEmoji.isSensitive !== newIsSensitive) {
            updatedFields.isSensitive = newIsSensitive;
            changed = true;
          }

          if (changed) {
            await this.emojisRepository.update(existingEmoji.id, { ...updatedFields, updatedAt: new Date() });
            updatedIds.push(existingEmoji.id);
            this.logger.info(`絵文字を更新しました: ${remoteEmoji.name}`);
          }
        } else {
          // 新しい絵文字を追加
          await this.emojisRepository.insertOne({
            id: remoteEmoji.id,
            updatedAt: new Date(),
            name: remoteEmoji.name,
            host: null,
            category: remoteEmoji.category ?? null,
            originalUrl: remoteEmoji.url,
            publicUrl: remoteEmoji.url,
            type: null, // Type is not provided by the remote API, setting to null
            aliases: remoteEmoji.aliases,
            license: remoteEmoji.license ?? null,
            isSensitive: remoteEmoji.aliases.includes('センシティブ'),
            localOnly: false,
            roleIdsThatCanBeUsedThisEmojiAsReaction: [],
          });
          addedIds.push(remoteEmoji.id);
          this.logger.info(`新しい絵文字を追加しました: ${remoteEmoji.name}`);
        }
      }

      // リモートで削除されたものと、公開範囲・モチーフの条件から外れたものを削除
      const deletedIds = existingEmojis.filter(e => !remoteEmojiMap.has(e.name)).map(e => e.id);
      if (deletedIds.length > 0) {
        await this.customEmojiService.deleteBulk(deletedIds);
      }
      if (addedIds.length > 0 || updatedIds.length > 0) {
        await this.customEmojiService.localEmojisCache.refresh();
      }
      if (updatedIds.length > 0) {
        this.globalEventService.publishBroadcastStream('emojiUpdated', {
          emojis: await this.emojiEntityService.packDetailedMany(updatedIds),
        });
      }
      for (const emoji of await this.emojiEntityService.packDetailedMany(addedIds)) {
        this.globalEventService.publishBroadcastStream('emojiAdded', { emoji });
      }

      this.logger.info('絵文字の同期が完了しました。');
    } catch (error: any) {
      this.logger.error(`絵文字の同期に失敗しました: ${error.message}`);
      // 取得・検証の失敗時は書き込み前に終了する。書き込み中の失敗は次回同期で再試行する。
    }
  }
}
