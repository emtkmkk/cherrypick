/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type { MiNote } from '@/models/Note.js';
import type { MiRemoteUser } from '@/models/User.js';
import { MiLocalRelaySubscriber } from '@/models/LocalRelaySubscriber.js';
import { RelayService } from '@/core/RelayService.js';
import { QueueService } from '@/core/QueueService.js';
import { ApRendererService } from '@/core/activitypub/ApRendererService.js';
import { getApId } from '@/core/activitypub/type.js';
import type { IFollow } from '@/core/activitypub/type.js';

/** Publishes only this server's notes to explicitly trusted relay subscribers. */
@Injectable()
export class LocalRelayService {
	constructor(
		@Inject(DI.config) private config: Config,
		@Inject(DI.db) private db: DataSource,
		private relayService: RelayService,
		private queueService: QueueService,
		private renderer: ApRendererService,
	) {}

	private inbox(actor: MiRemoteUser): { url: string; shared: boolean; } | null {
		if (actor.isSuspended || actor.isDeleted || !Array.isArray(this.config.localRelayHosts) || !this.config.localRelayHosts.includes(actor.host)) return null;
		try {
			if (!actor.inbox || new URL(actor.inbox).protocol !== 'https:' || new URL(actor.inbox).host !== actor.host) return null;
			const target = actor.sharedInbox ?? actor.inbox;
			if (!target) return null;
			const url = new URL(target);
			if (url.protocol !== 'https:' || url.host !== actor.host || url.username || url.password || url.hash) return null;
			return { url: url.href, shared: actor.sharedInbox != null };
		} catch { return null; }
	}

	/** Handles the standard relay Follow(Public) and its matching Undo after HTTP signature verification. */
	public async follow(actor: MiRemoteUser, activity: IFollow, undo = false): Promise<string | null> {
		if (getApId(activity.object) !== 'https://www.w3.org/ns/activitystreams#Public') return null;
		if (getApId(activity.actor) !== actor.uri || typeof activity.id !== 'string' || activity.id.length > 2048) return 'skip: invalid relay follow';
		try {
			if (new URL(activity.id).origin !== new URL(actor.uri).origin) return 'skip: invalid relay follow id';
		} catch { return 'skip: invalid relay follow id'; }
		const subscribers = this.db.getRepository(MiLocalRelaySubscriber);
		if (undo) {
			await subscribers.delete({ userId: actor.id, followId: activity.id });
			return 'ok: local relay unsubscribed';
		}
		if (!this.inbox(actor)) return 'skip: local relay host not permitted';
		const relayActor = await this.relayService.getRelayActor();
		await subscribers.upsert({ userId: actor.id, followId: activity.id }, ['userId']);
		await this.queueService.deliver(relayActor, this.renderer.addContext(this.renderer.renderAccept(activity, relayActor)), actor.inbox, false);
		return 'ok: local relay subscribed';
	}

	/** Returns subscribed inboxes without widening followers-only, direct, or non-federated notes. */
	public async getInboxes(note: Pick<MiNote, 'userHost' | 'visibility' | 'localOnly'>): Promise<Map<string, boolean>> {
		const inboxes = new Map<string, boolean>();
		if (!this.config.localRelayHosts?.length || note.userHost != null || note.localOnly || !['public', 'home'].includes(note.visibility)) return inboxes;
		const subscribers = await this.db.getRepository(MiLocalRelaySubscriber).find({ relations: ['user'] });
		for (const subscriber of subscribers) {
			if (!subscriber.user || subscriber.user.host == null) continue;
			const inbox = this.inbox(subscriber.user as MiRemoteUser);
			if (inbox) inboxes.set(inbox.url, inbox.shared);
		}
		return inboxes;
	}

	/** Protected bubble references may go back to their source realm, never to unrelated peers. */
	public async getReferenceInboxes(note: Pick<MiNote, 'userHost' | 'visibility' | 'localOnly'>, reference: Pick<MiNote, 'userHost' | 'visibility' | 'localOnly' | 'localAndFollowers'>): Promise<Map<string, boolean>> {
		if (!reference.localAndFollowers || reference.localOnly || !['public', 'home'].includes(reference.visibility)) return new Map();
		const inboxes = await this.getInboxes(note);
		if (reference.userHost != null) {
			for (const inbox of inboxes.keys()) if (new URL(inbox).host !== reference.userHost) inboxes.delete(inbox);
		}
		return inboxes;
	}
}
