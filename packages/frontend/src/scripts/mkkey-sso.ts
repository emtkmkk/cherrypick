/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { apiUrl } from '@@/js/config.js';

export type MkkeyAuthMode = 'signin' | 'signup' | 'link';
export type MkkeyLocalAuth = { i?: string; password?: string; token?: string; };

export async function mkkeySsoRequest<T>(path: string, body: object): Promise<T> {
	const response = await fetch(`${apiUrl}/mkkey-sso/${path}`, {
		method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
	});
	const result = await response.json();
	if (!response.ok) throw new Error(typeof result?.message === 'string' ? result.message : 'MKKEY_AUTH_FAILED');
	return result as T;
}

export function mkkeyAuthError(error: unknown): string {
	const code = error instanceof Error ? error.message : '';
	const messages: Record<string, string> = {
		POPUP_BLOCKED: '認証ウィンドウを開けませんでした。ポップアップを許可して、もう一度お試しください。',
		MKKEY_AUTH_CANCELLED: '認証がキャンセルされました。',
		MKKEY_AUTH_TIMEOUT: '認証がタイムアウトしました。もう一度お試しください。',
		MKKEY_AUTH_EXPIRED: '認証の有効期限が切れました。もう一度もこきーで認証してください。',
		MKKEY_ACCOUNT_NOT_LINKED: 'このもこきーアカウントは未連携です。新規登録するか、CherryPickに通常ログインして「セキュリティ」設定から連携してください。',
		MKKEY_ACCOUNT_ALREADY_LINKED: 'どちらかのアカウントが既に連携されています。連携状態をご確認ください。',
		MKKEY_SIGNUP_PENDING: '確認メールを送信済みです。メール内のリンクから登録を完了してください。',
		LOCAL_SIGNIN_REQUIRED: '通常の方法でCherryPickにログインしてください。このアカウントの認証設定では、もこきーだけでのログインは利用できません。',
		LOCAL_TWO_FACTOR_REQUIRED: 'CherryPickの2段階認証コードが必要です。',
		LOCAL_AUTH_FAILED: 'CherryPickのパスワードまたは2段階認証コードが正しくありません。',
		TOO_MANY_AUTHENTICATION_FAILURES: '認証の試行回数が多すぎます。時間をおいてお試しください。',
	};
	return messages[code] ?? 'もこきーの認証に失敗しました。もう一度お試しください。';
}

export async function runMkkeyAuth(mode: MkkeyAuthMode, localAuth: MkkeyLocalAuth = {}): Promise<string> {
	// Open synchronously, before the first request, so the user's click permits the popup.
	const popup = window.open('about:blank', '_blank', 'width=520,height=700');
	if (!popup) throw new Error('POPUP_BLOCKED');
	let cleanup = () => {};
	try {
		const { url, session } = await mkkeySsoRequest<{ url: string; session: string; }>('authorize-url', { mode, ...localAuth });
		const destination = new URL(url);
		if (destination.origin !== 'https://mkkey.net' || destination.pathname !== `/miauth/${session}`) throw new Error('MKKEY_AUTH_FAILED');
		return await new Promise<string>((resolve, reject) => {
			const finish = (error?: Error, token?: string) => {
				cleanup();
				if (error) reject(error);
				else if (token) resolve(token);
			};
			const listener = (event: MessageEvent<unknown>) => {
				if (event.origin !== new URL(apiUrl).origin || event.source !== popup || !event.data || typeof event.data !== 'object') return;
				const data = event.data as Record<string, unknown>;
				if (data.source !== 'mkkey-sso' || data.mode !== mode || data.session !== session || typeof data.oauthToken !== 'string') return;
				finish(undefined, data.oauthToken);
			};
			const timeout = window.setTimeout(() => finish(new Error('MKKEY_AUTH_TIMEOUT')), 5 * 60 * 1000);
			const closed = window.setInterval(() => {
				if (popup.closed) finish(new Error('MKKEY_AUTH_CANCELLED'));
			}, 1000);
			cleanup = () => {
				window.removeEventListener('message', listener);
				window.clearTimeout(timeout);
				window.clearInterval(closed);
			};
			window.addEventListener('message', listener);
			popup.location.href = url;
		});
	} finally {
		cleanup();
		popup.close();
	}
}
