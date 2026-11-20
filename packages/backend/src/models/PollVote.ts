/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PrimaryColumn, Entity, Index, JoinColumn, Column, ManyToOne } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiNote } from './Note.js';
import { MiPoll } from './Poll.js';

@Entity('poll_vote')
@Index(['userId', 'noteId', 'choice'], { unique: true })
export class MiPollVote {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column(id())
	public userId: MiUser['id'];

	@ManyToOne(type => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser | null;

	@Index()
	@Column(id())
	public noteId: MiNote['id'];

	@ManyToOne(type => MiNote, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public note: MiNote | null;

	@ManyToOne(() => MiPoll, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'noteId', referencedColumnName: 'noteId', foreignKeyConstraintName: 'FK_poll_vote_poll' })
	public poll: MiPoll | null;

	@Column('integer')
	public choice: number;
}
