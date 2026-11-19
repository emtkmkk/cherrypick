/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * @packageDocumentation
 *
 * バブルゲームのドロップ抽選バッグ。
 * 種類ごとの枚数を管理し、偏りの少ない順序で落とせるモノを供給する。
 *
 * @remarks
 * NOTE: プレイヤー向けの隠し仕様。UI や i18n には明記しない。
 *
 * @internal
 */

import type { Mono } from "./game.js";

/**
 * バッグ抽選の設定。
 *
 * @remarks
 * 案B: 初期は各種3枚、残数が種類数×2以下になったら各種1枚を補充する。
 *
 * @internal
 */
export type DropBagOptions = {
	/** 初期化時に各候補へ追加する枚数 */
	initialCopiesPerType: number;
	/** この枚数以下になったら補充する（種類数 × 2） */
	refillThreshold: number;
	/** 補充時に各候補へ追加する枚数 */
	refillCopiesPerType: number;
};

/**
 * 案Bのデフォルト設定（5種類前提: 初期15枚、閾値10枚、補充+5枚）。
 *
 * @internal
 */
export const DROP_BAG_OPTIONS_B: Omit<DropBagOptions, "refillThreshold"> = {
	initialCopiesPerType: 3,
	refillCopiesPerType: 1,
};

/**
 * ドロップ候補のバッグ抽選を管理する。
 *
 * @remarks
 * - 取り出しは先頭から行う（シャッフル済みキュー）
 * - 補充後はバッグ全体を再シャッフルし、取り出し順の偏りを抑える
 * - `rng` はゲーム本体と同じ `seedrandom` インスタンスを共有し、リプレイ再現性を保つ
 *
 * @internal
 */
export class DropBag {
	//#region フィールド

	private readonly candidates: Mono[];
	private readonly rng: () => number;
	private readonly options: DropBagOptions;
	private bag: Mono[] = [];

	//#endregion

	/**
	 * @param candidates - `dropCandidate: true` のモノ一覧
	 * @param rng - 0以上1未満の値を返す乱数関数
	 * @param options - バッグルール。省略時は案B
	 */
	constructor(
		candidates: Mono[],
		rng: () => number,
		options: Partial<DropBagOptions> = {},
	) {
		if (candidates.length === 0) {
			throw new Error("DropBag requires at least one candidate");
		}

		this.candidates = candidates;
		this.rng = rng;
		this.options = {
			initialCopiesPerType:
				options.initialCopiesPerType ?? DROP_BAG_OPTIONS_B.initialCopiesPerType,
			refillThreshold: options.refillThreshold ?? candidates.length * 2,
			refillCopiesPerType:
				options.refillCopiesPerType ?? DROP_BAG_OPTIONS_B.refillCopiesPerType,
		};

		this.initializeBag();
	}

	//#region 公開メソッド

	/**
	 * バッグから1枚取り出す。残数が閾値以下なら補充する。
	 *
	 * @returns 次にストックへ入るモノ
	 * @throws バッグが空のとき（通常は補充により発生しない）
	 */
	public draw(): Mono {
		if (this.bag.length === 0) {
			throw new Error("DropBag is empty");
		}

		const mono = this.bag.shift()!;

		if (this.bag.length <= this.options.refillThreshold) {
			this.refill();
		}

		return mono;
	}

	/**
	 * デバッグ・テスト用: バッグに残っている枚数。
	 *
	 * @internal
	 */
	public get remainingCount(): number {
		return this.bag.length;
	}

	//#endregion

	//#region 非公開ヘルパー

	private initializeBag(): void {
		this.bag = [];
		for (const candidate of this.candidates) {
			for (let i = 0; i < this.options.initialCopiesPerType; i++) {
				this.bag.push(candidate);
			}
		}
		this.shuffle();
	}

	private refill(): void {
		for (const candidate of this.candidates) {
			for (let i = 0; i < this.options.refillCopiesPerType; i++) {
				this.bag.push(candidate);
			}
		}
		this.shuffle();
	}

	/** Fisher-Yates シャッフル（`rng` で決定的） */
	private shuffle(): void {
		for (let i = this.bag.length - 1; i > 0; i--) {
			const j = Math.floor(this.rng() * (i + 1));
			const tmp = this.bag[i];
			this.bag[i] = this.bag[j];
			this.bag[j] = tmp;
		}
	}

	//#endregion
}
