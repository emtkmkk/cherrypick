/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { jest } from '@jest/globals';
import { MiUserProfile } from '@/models/UserProfile.js';
import { MiMkkeyAccountLink } from '@/models/MkkeyAccountLink.js';
import { MiUserPending } from '@/models/UserPending.js';

for (const name of ['UtilityService', 'UserService', 'IdService', 'InstanceActorService']) {
	jest.unstable_mockModule(`@/core/${name}.js`, () => ({ [name]: class {} }));
}
jest.unstable_mockModule('@/core/entities/UserEntityService.js', () => ({ UserEntityService: class {} }));
jest.unstable_mockModule('@/core/chart/charts/users.js', () => ({ default: class {} }));
const { SignupService } = await import('@/core/SignupService.js');

function setup() {
	const manager = {
		findOneBy: jest.fn(async () => null),
		save: jest.fn(async <T>(entity: T) => entity),
		insert: jest.fn(async () => ({})),
		delete: jest.fn(async () => ({})),
	};
	const db = { transaction: jest.fn(async (callback: (value: typeof manager) => Promise<void>) => callback(manager)) };
	const users = { exists: jest.fn(async () => false) };
	const used = { exists: jest.fn(async () => false) };
	const userService = { notifySystemWebhook: jest.fn() };
	const chart = { update: jest.fn() };
	const service = new SignupService(db as never, { preservedUsernames: [] } as never, users as never, used as never,
		{ toPunyNullable: () => null } as never, userService as never,
		{ validateLocalUsername: () => true, validatePassword: () => true } as never,
		{ gen: () => 'new-user' } as never, { realLocalUsersPresent: async () => true } as never, chart as never);
	return { service, manager, db, chart, userService };
}

describe('atomic mkkey registration', () => {
	const identity = { mkkeyUserId: 'stable-provider-id', mkkeyUsernameLower: 'mkkeyname' };
	test('saves the link and verified email, and removes the pending record in the user transaction', async () => {
		const s = setup();
		const result = await s.service.signup({ username: 'local', passwordHash: 'already-hashed', mkkeyIdentity: identity, pendingUserId: 'pending', verifiedEmail: 'user@example.com' });
		expect(s.db.transaction).toHaveBeenCalledTimes(1);
		expect(s.manager.insert).toHaveBeenCalledWith(MiMkkeyAccountLink, { ...identity, userId: result.account.id });
		expect(s.manager.delete).toHaveBeenCalledWith(MiUserPending, { id: 'pending' });
		const profile = s.manager.save.mock.calls.map(([entity]) => entity).find(entity => entity instanceof MiUserProfile);
		expect(profile).toMatchObject({ email: 'user@example.com', emailVerified: true, emailVerifyCode: null, password: 'already-hashed' });
		expect(s.chart.update).toHaveBeenCalledTimes(1);
	});

	test('propagates a link collision to roll back the transaction before deleting the pending record or publishing user creation', async () => {
		const s = setup();
		const conflict = Object.assign(new Error('duplicate identity'), { code: '23505' });
		s.manager.insert.mockRejectedValueOnce(conflict);
		await expect(s.service.signup({ username: 'local', passwordHash: 'already-hashed', mkkeyIdentity: identity, pendingUserId: 'pending' })).rejects.toBe(conflict);
		expect(s.manager.delete).not.toHaveBeenCalled();
		expect(s.chart.update).not.toHaveBeenCalled();
		expect(s.userService.notifySystemWebhook).not.toHaveBeenCalled();
	});

	test('keeps normal signup independent of mkkey linkage', async () => {
		const s = setup();
		await s.service.signup({ username: 'local', passwordHash: 'already-hashed' });
		expect(s.manager.insert).not.toHaveBeenCalled();
		expect(s.manager.delete).not.toHaveBeenCalled();
	});
});
