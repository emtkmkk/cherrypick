/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { MiUser } from './User.js';

@Entity('mkkey_account_link')
export class MiMkkeyAccountLink {
	@PrimaryGeneratedColumn()
	public id: number;

	@Index('IDX_mkkey_account_link_mkkey_user_id', { unique: true })
	@Column('varchar', {
		length: 128,
	})
	public mkkeyUserId: string;

	@Column('varchar', {
		length: 128,
	})
	public mkkeyUsernameLower: string;

	@Index('IDX_mkkey_account_link_user_id', { unique: true })
	@Column('varchar', {
		length: 32,
	})
	public userId: MiUser['id'];

	@ManyToOne(type => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_mkkey_account_link_user_id' })
	public user: MiUser | null;

	@CreateDateColumn({
		type: 'timestamp with time zone',
	})
	public createdAt: Date;
}
