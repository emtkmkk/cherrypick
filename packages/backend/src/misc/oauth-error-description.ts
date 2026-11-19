/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** RFC 6750 section 3 permits only printable ASCII except quotes and backslashes. */
export function encodeOAuthErrorDescription(message: string): string {
	return message.replace(/[^\x20\x21\x23-\x5B\x5D-\x7E]+/gu, value => encodeURIComponent(value));
}
