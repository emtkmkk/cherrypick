/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { MiUser } from './User.js';
import { id } from './util/id.js';

/** A relay subscription from a server sharing the local note scope. */
@Entity('local_relay_subscriber')
export class MiLocalRelaySubscriber {
	@PrimaryColumn(id())
	public userId: string;

	@Column('varchar', { length: 2048 })
	public followId: string;

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_local_relay_subscriber_user' })
	public user: MiUser;
}
