<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_gaps_m">
	<FormSection first>
		<template #label>{{ i18n.ts.password }}</template>
		<MkButton primary @click="change()">{{ i18n.ts.changePassword }}</MkButton>
	</FormSection>

	<FormSection>
		<template #label>もこきーでログイン（mkkey.net）</template>
		<div class="_gaps_s">
			<p v-if="mkkeyLink?.linked">連携中: @{{ mkkeyLink.username }}@mkkey.net</p>
			<p v-else-if="mkkeyLink">未連携です。連携すると、同じもこきーアカウントでCherryPickにログインできます。</p>
			<p v-else>{{ mkkeyStatusError || '連携状態を確認しています…' }}</p>
			<MkButton v-if="mkkeyStatusError" @click="loadMkkeyLink">再確認</MkButton>
			<MkButton v-else-if="mkkeyLink?.linked" danger :disabled="mkkeyBusy" @click="unlinkMkkey">連携を解除</MkButton>
			<MkButton v-else primary :disabled="mkkeyBusy || !mkkeyLink" @click="linkMkkey">もこきーアカウントと連携</MkButton>
			<p>連携・解除にはCherryPickのパスワードと、有効な場合は2段階認証コードが必要です。</p>
		</div>
	</FormSection>

	<X2fa/>

	<FormSection>
		<template #label>{{ i18n.ts.signinHistory }}</template>
		<MkPagination :pagination="pagination" disableAutoLoad>
			<template #default="{items}">
				<div>
					<div v-for="item in items" :key="item.id" v-panel class="timnmucd">
						<header>
							<i v-if="item.success" class="ti ti-check icon succ"></i>
							<i v-else class="ti ti-circle-x icon fail"></i>
							<code class="ip _monospace">{{ item.ip }}</code>
							<MkTime :time="item.createdAt" class="time"/>
						</header>
					</div>
				</div>
			</template>
		</MkPagination>
	</FormSection>

	<FormSection>
		<FormSlot>
			<MkButton danger @click="regenerateToken"><i class="ti ti-refresh"></i> {{ i18n.ts.regenerateLoginToken }}</MkButton>
			<template #caption>{{ i18n.ts.regenerateLoginTokenDescription }}</template>
		</FormSlot>
	</FormSection>
</div>
</template>

<script lang="ts" setup>
import { computed, ref, onMounted } from 'vue';
import X2fa from './2fa.vue';
import { $i } from '@/account.js';
import { runMkkeyAuth, mkkeySsoRequest, mkkeyAuthError } from '@/scripts/mkkey-sso.js';
import FormSection from '@/components/form/section.vue';
import FormSlot from '@/components/form/slot.vue';
import MkButton from '@/components/MkButton.vue';
import MkPagination from '@/components/MkPagination.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/scripts/misskey-api.js';
import { i18n } from '@/i18n.js';
import { definePageMetadata } from '@/scripts/page-metadata.js';

const mkkeyLink = ref<{ linked: boolean; username: string | null; } | null>(null);
const mkkeyBusy = ref(false);
const mkkeyStatusError = ref('');

async function loadMkkeyLink() {
	mkkeyStatusError.value = '';
	try {
		mkkeyLink.value = await mkkeySsoRequest('status', { i: $i?.token });
	} catch (error) {
		mkkeyStatusError.value = mkkeyAuthError(error);
	}
}

async function linkMkkey() {
	if (mkkeyBusy.value || !$i) return;
	const auth = await os.authenticateDialog();
	if (auth.canceled) return;
	mkkeyBusy.value = true;
	try {
		const oauthToken = await runMkkeyAuth('link', { i: $i.token, password: auth.result.password, token: auth.result.token ?? undefined });
		await mkkeySsoRequest('link', { i: $i.token, oauthToken });
		await loadMkkeyLink();
		await os.alert({ type: 'success', text: 'もこきーアカウントと連携しました。次回からもこきーでログインできます。' });
	} catch (error) {
		await os.alert({ type: 'error', text: mkkeyAuthError(error) });
	} finally {
		mkkeyBusy.value = false;
	}
}

async function unlinkMkkey() {
	if (mkkeyBusy.value || !$i) return;
	const auth = await os.authenticateDialog();
	if (auth.canceled) return;
	mkkeyBusy.value = true;
	try {
		await mkkeySsoRequest('unlink', { i: $i.token, password: auth.result.password, token: auth.result.token });
		await loadMkkeyLink();
	} catch (error) {
		await os.alert({ type: 'error', text: mkkeyAuthError(error) });
	} finally {
		mkkeyBusy.value = false;
	}
}

onMounted(loadMkkeyLink);

const pagination = {
	endpoint: 'i/signin-history' as const,
	limit: 5,
};

async function change() {
	const { canceled: canceled2, result: newPassword } = await os.inputText({
		title: i18n.ts.newPassword,
		type: 'password',
		autocomplete: 'new-password',
	});
	if (canceled2) return;

	const { canceled: canceled3, result: newPassword2 } = await os.inputText({
		title: i18n.ts.newPasswordRetype,
		type: 'password',
		autocomplete: 'new-password',
	});
	if (canceled3) return;

	if (newPassword !== newPassword2) {
		os.alert({
			type: 'error',
			text: i18n.ts.retypedNotMatch,
		});
		return;
	}

	const auth = await os.authenticateDialog();
	if (auth.canceled) return;

	os.apiWithDialog('i/change-password', {
		currentPassword: auth.result.password,
		token: auth.result.token,
		newPassword,
	});
}

async function regenerateToken() {
	const auth = await os.authenticateDialog();
	if (auth.canceled) return;

	misskeyApi('i/regenerate-token', {
		password: auth.result.password,
		token: auth.result.token,
	});
}

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePageMetadata(() => ({
	title: i18n.ts.security,
	icon: 'ti ti-lock',
}));
</script>

<style lang="scss" scoped>
.timnmucd {
	padding: 12px;

	&:first-child {
		border-top-left-radius: 6px;
		border-top-right-radius: 6px;
	}

	&:last-child {
		border-bottom-left-radius: 6px;
		border-bottom-right-radius: 6px;
	}

	&:not(:last-child) {
		border-bottom: solid 0.5px var(--MI_THEME-divider);
	}

	> header {
		display: flex;
		align-items: center;

		> .icon {
			width: 1em;
			margin-right: 0.75em;

			&.succ {
				color: var(--MI_THEME-success);
			}

			&.fail {
				color: var(--MI_THEME-error);
			}
		}

		> .ip {
			flex: 1;
			min-width: 0;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			margin-right: 12px;
		}

		> .time {
			margin-left: auto;
			opacity: 0.7;
		}
	}
}
</style>
