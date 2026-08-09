/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, CreateDateColumn, Entity, Index, JoinColumn, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { MiUser } from './User.js';

@Entity('mkkey_account_link')
export class MiMkkeyAccountLink {
	@PrimaryGeneratedColumn()
	public id: number;

	@Index({ unique: true })
	@Column('varchar', {
		length: 128,
	})
	public mkkeyUserId: string;

	@Index({ unique: true })
	@Column('varchar', {
		length: 128,
	})
	public mkkeyUsernameLower: string;

	@Index({ unique: true })
	@Column('varchar', {
		length: 32,
	})
	public userId: MiUser['id'];

	@OneToOne(type => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'userId' })
	public user: MiUser | null;

	@CreateDateColumn({
		type: 'timestamp with time zone',
	})
	public createdAt: Date;
}
