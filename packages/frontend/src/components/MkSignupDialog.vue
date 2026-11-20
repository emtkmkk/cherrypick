<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="500"
	:height="600"
	@close="onClose"
	@closed="emit('closed')"
>
	<template #header>{{ i18n.ts.signup }}</template>

	<div style="overflow-x: clip;">
		<Transition
			mode="out-in"
			:enterActiveClass="$style.transition_x_enterActive"
			:leaveActiveClass="$style.transition_x_leaveActive"
			:enterFromClass="$style.transition_x_enterFrom"
			:leaveToClass="$style.transition_x_leaveTo"
		>
			<template v-if="!registrationMethod">
				<MkSpacer :marginMin="20" :marginMax="32">
					<div class="_gaps_m">
						<MkButton full rounded gradate @click="registrationMethod = 'mkkey'">{{ i18n.ts.signupWithMkkey }}</MkButton>
						<MkButton full rounded @click="registrationMethod = 'invitation'">{{ i18n.ts.signupWithInvitationCode }}</MkButton>
					</div>
				</MkSpacer>
			</template>
			<template v-else-if="!isAcceptedServerRule">
				<XServerRules :busy="authenticating" @done="continueAfterRules" @cancel="onClose"/>
			</template>
			<template v-else>
				<XSignup :autoSet="autoSet" :mkkeyOauthToken="mkkeyOauthToken" @back="isAcceptedServerRule = false" @signup="onSignup" @signupEmailPending="onSignupEmailPending"/>
			</template>
		</Transition>
	</div>
</MkModalWindow>
</template>

<script lang="ts" setup>
import { useTemplateRef, ref } from 'vue';
import * as Misskey from 'cherrypick-js';
import XSignup from '@/components/MkSignupDialog.form.vue';
import XServerRules from '@/components/MkSignupDialog.rules.vue';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkButton from '@/components/MkButton.vue';
import { i18n } from '@/i18n.js';
import { login } from '@/accounts.js';
import { runMkkeyAuth, mkkeyAuthError } from '@/utility/mkkey-sso.js';
import { signinOrContinueMkkeySignup } from '@/utility/mkkey-signup.js';
import * as os from '@/os.js';

const props = withDefaults(defineProps<{
	autoSet?: boolean;
	method?: 'mkkey' | 'invitation';
}>(), {
	autoSet: false,
	method: undefined,
});

const emit = defineEmits<{
	(ev: 'done', res: Misskey.entities.SignupResponse): void;
	(ev: 'signin', res: { id: string; token: string; }): void;
	(ev: 'cancelled'): void;
	(ev: 'closed'): void;
}>();

const dialog = useTemplateRef('dialog');

const isAcceptedServerRule = ref(false);
// The caller chooses the initial route; the account creation menu can choose it here.
// eslint-disable-next-line vue/no-setup-props-reactivity-loss
const registrationMethod = ref(props.method);
const mkkeyOauthToken = ref('');
const authenticating = ref(false);
let cancelled = false;

async function continueAfterRules() {
	if (authenticating.value || cancelled) return;
	if (registrationMethod.value === 'invitation') {
		isAcceptedServerRule.value = true;
		return;
	}
	authenticating.value = true;
	try {
		const oauthToken = await runMkkeyAuth('signup');
		if (cancelled) return;
		const result = await signinOrContinueMkkeySignup(oauthToken);
		if (cancelled || result.type === 'cancelled') return;
		if (result.type === 'signedIn') {
			emit('signin', { id: result.id, token: result.token });
			dialog.value?.close();
			if (props.autoSet) await login(result.token);
			return;
		}
		mkkeyOauthToken.value = oauthToken;
		isAcceptedServerRule.value = true;
	} catch (error) {
		if (!cancelled) await os.alert({ type: 'error', text: mkkeyAuthError(error) });
	} finally {
		authenticating.value = false;
	}
}

function onClose() {
	cancelled = true;
	emit('cancelled');
	dialog.value?.close();
}

function onSignup(res: Misskey.entities.SignupResponse) {
	emit('done', res);
	dialog.value?.close();
}

function onSignupEmailPending() {
	dialog.value?.close();
}
</script>

<style lang="scss" module>
.transition_x_enterActive,
.transition_x_leaveActive {
	transition: opacity 0.3s cubic-bezier(0,0,.35,1), transform 0.3s cubic-bezier(0,0,.35,1);
}
.transition_x_enterFrom {
	opacity: 0;
	transform: translateX(50px);
}
.transition_x_leaveTo {
	opacity: 0;
	transform: translateX(-50px);
}
</style>
