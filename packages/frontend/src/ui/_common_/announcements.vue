<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div v-if="$i" :class="$style.root">
	<div v-if="mkkeyLink && !mkkeyLink.linked && !linkNoticeDismissed" :class="[$style.item, $style.linkNotice]">
		<span :class="$style.title"><i class="ti ti-link"></i> もこきーアカウントが未連携です。</span>
		<button class="_button" :class="$style.linkButton" :disabled="mkkeyLinkBusy" @click="linkMkkeyAccount">連携する</button>
		<button class="_button" :class="$style.dismiss" :aria-label="i18n.ts.close" :title="i18n.ts.close" @click="dismissLinkNotice"><i class="ti ti-x"></i></button>
	</div>
	<MkA
		v-for="announcement in $i.unreadAnnouncements.filter(x => x.display === 'banner')"
		:key="announcement.id"
		:class="$style.item"
		:to="`/announcements/${announcement.id}`"
	>
		<span :class="$style.icon">
			<i v-if="announcement.icon === 'info'" class="ti ti-info-circle"></i>
			<i v-else-if="announcement.icon === 'warning'" class="ti ti-alert-triangle" style="color: var(--MI_THEME-warn);"></i>
			<i v-else-if="announcement.icon === 'error'" class="ti ti-circle-x" style="color: var(--MI_THEME-error);"></i>
			<i v-else-if="announcement.icon === 'success'" class="ti ti-check" style="color: var(--MI_THEME-success);"></i>
		</span>
		<span :class="$style.title">{{ announcement.title }}</span>
		<span :class="$style.body">{{ announcement.text }}</span>
	</MkA>
</div>
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import { $i } from '@/account.js';
import { mkkeyLink, mkkeyLinkBusy, loadMkkeyLink, linkMkkeyAccount } from '@/scripts/mkkey-link.js';
import { i18n } from '@/i18n.js';

const linkNoticeDismissed = ref(false);
const dismissKey = `mkkey-link-notice-dismissed:${$i?.id}`;

onMounted(() => {
	if (!$i) return;
	try { linkNoticeDismissed.value = sessionStorage.getItem(dismissKey) === '1'; } catch { /* Storage may be unavailable. */ }
	loadMkkeyLink().catch(() => {});
});

function dismissLinkNotice() {
	linkNoticeDismissed.value = true;
	try { sessionStorage.setItem(dismissKey, '1'); } catch { /* Keep the in-memory dismissal. */ }
}
</script>

<style lang="scss" module>
.root {
	font-size: 15px;
	background: var(--MI_THEME-panel);
}

.item {
	--height: 24px;
	font-size: 0.85em;

	display: flex;
	vertical-align: bottom;
	width: 100%;
	line-height: var(--height);
	height: var(--height);
	overflow: clip;
	contain: strict;
	background: var(--MI_THEME-accent);
	color: var(--MI_THEME-fgOnAccent);

	@container (max-width: 1000px) {
		display: block;
		text-align: center;

		> .body {
			display: none;
		}
	}
}

.icon {
	margin-left: 10px;
}

.linkNotice {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	height: auto;
	min-height: 28px;
	contain: none;
	text-align: start;
}

.linkButton {
	flex-shrink: 0;
	margin: 2px 8px 2px 0;
	padding: 0 8px;
	border: 1px solid currentColor;
	border-radius: 4px;
	line-height: 20px;

	&:disabled {
		opacity: 0.5;
	}
}

.dismiss {
	margin-left: auto;
	padding: 0 8px;
}

.title {
	padding: 0 10px;
	font-weight: bold;

	&:empty {
		display: none;
	}
}

.body {
	min-width: 0;
	flex: 1;
	overflow: clip;
	white-space: nowrap;
	text-overflow: ellipsis;
}
</style>
