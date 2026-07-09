/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { EventEmitter } from 'eventemitter3';
import * as Matter from 'matter-js';
import seedrandom from 'seedrandom';
import { DropBag } from './drop-bag.js';
import {
	NORAML_MONOS,
	SQUARE_MONOS,
	SWEETS_MONOS,
	YEN_MONOS,
} from './monos.js';

export type Mono = {
	id: string;
	level: number;
	sizeX: number;
	sizeY: number;
	shape: 'circle' | 'rectangle' | 'custom';
	vertices?: Matter.Vector[][];
	verticesSize?: number;
	score: number;
	dropCandidate: boolean;
};

type Log =
	| {
			frame: number;
			operation: 'drop';
			x: number;
	  }
	| {
			frame: number;
			operation: 'hold';
	  }
	| {
			frame: number;
			operation: 'surrender';
	  };

export class DropAndFusionGame extends EventEmitter<{
	changeScore: (newScore: number) => void;
	changeCombo: (newCombo: number) => void;
	changeStock: (newStock: { id: string; mono: Mono }[]) => void;
	changeHolding: (newHolding: { id: string; mono: Mono } | null) => void;
	dropped: (x: number) => void;
	fusioned: (
		x: number,
		y: number,
		nextMono: Mono | null,
		scoreDelta: number,
	) => void;
	collision: (energy: number, bodyA: Matter.Body, bodyB: Matter.Body) => void;
	monoAdded: (mono: Mono) => void;
	changeLives: (lives: number) => void;
	gameOver: () => void;
}> {
	private PHYSICS_QUALITY_FACTOR = 16; // 低いほどパフォーマンスが高いがガタガタして安定しなくなる、逆に高すぎても何故か不安定になる
	private COMBO_INTERVAL = 180; // frame
	/** 合体予約・再合体クールダウン（ms） */
	private readonly FUSION_RESERVE_MS = 100;
	private readonly FUSION_READY_DELAY_MS = 100;
	/** 特別合体（追いつき）の猶予時間（ms） */
	private readonly FUSION_TRIPLE_GRACE_MS = 100;
	public readonly GAME_VERSION = 4;
	public readonly GAME_WIDTH = 450;
	public readonly GAME_HEIGHT = 600;
	public readonly DROP_COOLTIME = 30; // frame
	public readonly PLAYAREA_MARGIN = 25;
	private STOCK_MAX = 4;
	private TICK_DELTA = 1000 / 60; // 60fps

	public frame = 0;
	public engine: Matter.Engine;
	private tickCallbackQueue: { frame: number; callback: () => void }[] = [];
	private overflowCollider: Matter.Body;
	private isGameOver = false;
	private lostLifeThisDrop = false;
	private dropsSinceLifeLost = 0;
	private _lives = 3;
	private gameMode: 'normal' | 'yen' | 'square' | 'sweets' | 'space';
	private rng: () => number;
	private dropBag: DropBag;
	private logs: Log[] = [];

	/**
	 * フィールドに出ていて、かつ合体の対象となるアイテム
	 */
	private fusionReadyBodyIds: Matter.Body['id'][] = [];

	private gameOverReadyBodyIds: Matter.Body['id'][] = [];

	/**
	 * fusion予約アイテムのペア
	 * TODO: これらのモノは光らせるなどの演出をすると視覚的に楽しそう
	 */
	private fusionReservedPairs: { bodyA: Matter.Body; bodyB: Matter.Body }[] =
		[];

	/**
	 * 追いつき合体の対象として登録中の生成物
	 *
	 * @remarks
	 * NOTE: すべての2体合体後に登録し、100ms以内に level-1 が接触したら productLevel+1 へ昇格する
	 */
	private recentSpecialFusions: {
		bodyId: Matter.Body['id'];
		productLevel: number;
		expiresFrame: number;
	}[] = [];

	/** 同一フレーム内のクラスター合体二重処理防止 */
	private clusterFusedBodyIds = new Set<Matter.Body['id']>();

	private latestDroppedAt = 0; // frame
	private latestFusionedAt = 0; // frame
	private stock: { id: string; mono: Mono }[] = [];
	private holding: { id: string; mono: Mono } | null = null;

	public get monoDefinitions() {
		switch (this.gameMode) {
			case 'normal':
				return NORAML_MONOS;
			case 'yen':
				return YEN_MONOS;
			case 'square':
				return SQUARE_MONOS;
			case 'sweets':
				return SWEETS_MONOS;
			case 'space':
				return NORAML_MONOS;
		}
	}

	private _combo = 0;
	private get combo() {
		return this._combo;
	}
	private set combo(value: number) {
		this._combo = value;
		this.emit('changeCombo', value);
	}

	private _score = 0;
	private get score() {
		return this._score;
	}
	private set score(value: number) {
		this._score = value;
		this.emit('changeScore', value);
	}

	private get lives() {
		return this._lives;
	}
	private set lives(value: number) {
		this._lives = value;
		this.emit('changeLives', value);
	}

	private getMonoRenderOptions:
		| null
		| ((mono: Mono) => Partial<Matter.IBodyRenderOptions>) = null;

	public replayPlaybackRate = 1;

	constructor(env: {
		seed: string;
		gameMode: DropAndFusionGame['gameMode'];
		getMonoRenderOptions?: (mono: Mono) => Partial<Matter.IBodyRenderOptions>;
	}) {
		super();

		//#region BIND
		this.tick = this.tick.bind(this);
		//#endregion

		this.gameMode = env.gameMode;
		this.getMonoRenderOptions = env.getMonoRenderOptions ?? null;
		this.rng = seedrandom(env.seed);
		this.dropBag = new DropBag(
			this.monoDefinitions.filter((x) => x.dropCandidate),
			this.rng,
		);

		// sweetsモードは重いため
		const physicsQualityFactor =
			this.gameMode === 'sweets' ? 4 : this.PHYSICS_QUALITY_FACTOR;
		this.engine = Matter.Engine.create({
			constraintIterations: 2 * physicsQualityFactor,
			positionIterations: 6 * physicsQualityFactor,
			velocityIterations: 4 * physicsQualityFactor,
			gravity: {
				x: 0,
				y: this.gameMode === 'space' ? 0.0125 : 1,
			},
			timing: {
				timeScale: 2,
			},
			enableSleeping: false,
		});

		this.engine.world.bodies = [];

		//#region walls
		const WALL_OPTIONS: Matter.IChamferableBodyDefinition = {
			label: '_wall_',
			isStatic: true,
			friction: 0.7,
			slop: this.gameMode === 'space' ? 0.01 : 0.7,
			render: {
				strokeStyle: 'transparent',
				fillStyle: 'transparent',
			},
		};

		const thickness = 100;
		Matter.Composite.add(this.engine.world, [
			Matter.Bodies.rectangle(
				this.GAME_WIDTH / 2,
				this.GAME_HEIGHT + thickness / 2 - this.PLAYAREA_MARGIN,
				this.GAME_WIDTH,
				thickness,
				WALL_OPTIONS,
			),
			Matter.Bodies.rectangle(
				this.GAME_WIDTH + thickness / 2 - this.PLAYAREA_MARGIN,
				this.GAME_HEIGHT / 2,
				thickness,
				this.GAME_HEIGHT,
				WALL_OPTIONS,
			),
			Matter.Bodies.rectangle(
				-(thickness / 2 - this.PLAYAREA_MARGIN),
				this.GAME_HEIGHT / 2,
				thickness,
				this.GAME_HEIGHT,
				WALL_OPTIONS,
			),
		]);
		//#endregion

		this.overflowCollider = Matter.Bodies.rectangle(
			this.GAME_WIDTH / 2,
			0,
			this.GAME_WIDTH,
			200,
			{
				label: '_overflow_',
				isStatic: true,
				isSensor: true,
				render: {
					strokeStyle: 'transparent',
					fillStyle: 'transparent',
				},
			},
		);
		Matter.Composite.add(this.engine.world, this.overflowCollider);
	}

	public msToFrame(ms: number) {
		return Math.round(ms / this.TICK_DELTA);
	}

	public frameToMs(frame: number) {
		return frame * this.TICK_DELTA;
	}

	private createBody(mono: Mono, x: number, y: number) {
		const options: Matter.IBodyDefinition = {
			label: mono.id,
			density:
				this.gameMode === 'space'
					? 0.01
					: (mono.sizeX * mono.sizeY) ** 0.8 / 2500,
			restitution: this.gameMode === 'space' ? 0.5 : 0.25,
			frictionAir: this.gameMode === 'space' ? 0 : 0.01,
			friction: this.gameMode === 'space' ? 0.5 : 0.7,
			frictionStatic: this.gameMode === 'space' ? 0 : 5,
			slop: this.gameMode === 'space' ? 0.01 : 0.7,
			//mass: 0,
			render: this.getMonoRenderOptions
				? this.getMonoRenderOptions(mono)
				: undefined,
		};
		if (mono.shape === 'circle') {
			return Matter.Bodies.circle(x, y, mono.sizeX / 2, options);
		} else if (mono.shape === 'rectangle') {
			return Matter.Bodies.rectangle(x, y, mono.sizeX, mono.sizeY, options);
		} else if (
			mono.shape === 'custom' &&
			mono.vertices != null &&
			mono.verticesSize != null
		) {
			return Matter.Bodies.fromVertices(
				x,
				y,
				mono.vertices.map((i) =>
					i.map((j) => ({
						x: (j.x / mono.verticesSize!) * mono.sizeX, //eslint-disable-line @typescript-eslint/no-non-null-assertion
						y: (j.y / mono.verticesSize!) * mono.sizeY, //eslint-disable-line @typescript-eslint/no-non-null-assertion
					})),
				),
				options,
			);
		} else {
			throw new Error('unrecognized shape');
		}
	}

	private createStockItem(): { id: string; mono: Mono } {
		return {
			id: this.rng().toString(),
			mono: this.dropBag.draw(),
		};
	}

	//#region 合体ヘルパー

	/**
	 * フィールド上のモノボディかどうかを判定する
	 *
	 * @param body - 判定対象
	 * @returns 合体対象のモノであれば true
	 * @internal
	 */
	private isFusibleMonoBody(body: Matter.Body): boolean {
		return (
			body.label !== '_wall_' &&
			body.label !== '_overflow_' &&
			!body.isStatic &&
			this.monoDefinitions.some((m) => m.id === body.label)
		);
	}

	/**
	 * ボディに対応するモノ定義を取得する
	 *
	 * @param body - 対象ボディ
	 * @returns モノ定義。見つからなければ null
	 * @internal
	 */
	private getMonoByBody(body: Matter.Body): Mono | null {
		return this.monoDefinitions.find((m) => m.id === body.label) ?? null;
	}

	/**
	 * モノ定義の最高レベルを返す
	 *
	 * @returns 最高レベル
	 * @internal
	 */
	private getMaxMonoLevel(): number {
		return Math.max(...this.monoDefinitions.map((m) => m.level));
	}

	/**
	 * 合体時のコンボを進める
	 *
	 * @internal
	 */
	private advanceFusionCombo(): void {
		if (this.latestFusionedAt > this.frame - this.COMBO_INTERVAL) {
			this.combo++;
		} else {
			this.combo = 1;
		}
		this.latestFusionedAt = this.frame;
	}

	/**
	 * 2体合体1回分のスコアを計算する
	 *
	 * @param mono - 合体元モノ
	 * @param isMaxLevelFusion - 最上位レベルへの合体（次レベルなし）か
	 * @returns 加算スコア
	 * @internal
	 */
	private fusionPairScore(mono: Mono, isMaxLevelFusion: boolean): number {
		if (
			isMaxLevelFusion &&
			this.gameMode !== 'yen' &&
			this.gameMode !== 'sweets'
		) {
			return 9999;
		}
		const hasComboBonus = this.gameMode !== 'yen' && this.gameMode !== 'sweets';
		return (
			mono.score +
			(hasComboBonus && this.combo >= 3 ? Math.min(this.combo - 2, 8) : 0)
		);
	}

	/**
	 * 追いつき合体対象として生成物を登録する
	 *
	 * @param body - 生成されたボディ
	 * @param productLevel - 生成物のレベル
	 * @internal
	 */
	private registerSpecialFusion(body: Matter.Body, productLevel: number): void {
		this.recentSpecialFusions = this.recentSpecialFusions.filter(
			(x) => x.bodyId !== body.id,
		);
		this.recentSpecialFusions.push({
			bodyId: body.id,
			productLevel,
			expiresFrame: this.frame + this.msToFrame(this.FUSION_TRIPLE_GRACE_MS),
		});
	}

	/**
	 * 追いつき合体の登録を解除する
	 *
	 * @param bodyId - 対象ボディID
	 * @internal
	 */
	private unregisterSpecialFusion(bodyId: Matter.Body['id']): void {
		this.recentSpecialFusions = this.recentSpecialFusions.filter(
			(x) => x.bodyId !== bodyId,
		);
	}

	/**
	 * 期限切れ・消滅済みの追いつき登録を掃除する
	 *
	 * @internal
	 */
	private cleanupExpiredSpecialFusions(): void {
		const bodyIds = new Set(this.engine.world.bodies.map((b) => b.id));
		this.recentSpecialFusions = this.recentSpecialFusions.filter(
			(x) => x.expiresFrame > this.frame && bodyIds.has(x.bodyId),
		);
	}

	/**
	 * 合体によりボディをフィールドから除去する
	 *
	 * @param bodies - 除去するボディ
	 * @internal
	 */
	private removeBodiesForFusion(...bodies: Matter.Body[]): void {
		const bodyIds = new Set(bodies.map((b) => b.id));
		this.fusionReadyBodyIds = this.fusionReadyBodyIds.filter(
			(x) => !bodyIds.has(x),
		);
		this.gameOverReadyBodyIds = this.gameOverReadyBodyIds.filter(
			(x) => !bodyIds.has(x),
		);
		this.fusionReservedPairs = this.fusionReservedPairs.filter(
			(x) => !bodyIds.has(x.bodyA.id) && !bodyIds.has(x.bodyB.id),
		);
		for (const id of bodyIds) {
			this.unregisterSpecialFusion(id);
		}
		Matter.Composite.remove(this.engine.world, bodies);
	}

	/**
	 * 合体で生成物ボディを追加し、再合体クールダウンと追いつき登録を行う
	 *
	 * @param nextMono - 生成するモノ
	 * @param x - X座標
	 * @param y - Y座標
	 * @returns 追加したボディ
	 * @internal
	 */
	private addFusionProductBody(
		nextMono: Mono,
		x: number,
		y: number,
	): Matter.Body {
		const body = this.createBody(nextMono, x, y);
		Matter.Composite.add(this.engine.world, body);

		this.tickCallbackQueue.push({
			frame: this.frame + this.msToFrame(this.FUSION_READY_DELAY_MS),
			callback: () => {
				this.fusionReadyBodyIds.push(body.id);
			},
		});

		this.emit('monoAdded', nextMono);
		this.registerSpecialFusion(body, nextMono.level);
		return body;
	}

	/**
	 * 接触ペアから同ラベルの連結成分を構築する
	 *
	 * @param pairs - 接触ペア一覧
	 * @returns 連結成分ごとのボディ配列
	 * @internal
	 */
	private buildSameLabelConnectedComponents(
		pairs: Matter.Pair[],
	): Matter.Body[][] {
		const adjacency = new Map<Matter.Body['id'], Set<Matter.Body['id']>>();
		const bodyById = new Map<Matter.Body['id'], Matter.Body>();

		const addEdge = (a: Matter.Body, b: Matter.Body) => {
			if (!this.isFusibleMonoBody(a) || !this.isFusibleMonoBody(b)) return;
			if (a.label !== b.label) return;
			bodyById.set(a.id, a);
			bodyById.set(b.id, b);
			if (!adjacency.has(a.id)) adjacency.set(a.id, new Set());
			if (!adjacency.has(b.id)) adjacency.set(b.id, new Set());
			adjacency.get(a.id)!.add(b.id);
			adjacency.get(b.id)!.add(a.id);
		};

		for (const pair of pairs) {
			addEdge(pair.bodyA, pair.bodyB);
		}

		const visited = new Set<Matter.Body['id']>();
		const components: Matter.Body[][] = [];

		for (const startId of adjacency.keys()) {
			if (visited.has(startId)) continue;
			const queue = [startId];
			const component: Matter.Body[] = [];
			visited.add(startId);
			while (queue.length > 0) {
				const id = queue.shift()!;
				const body = bodyById.get(id);
				if (body) component.push(body);
				for (const neighbor of adjacency.get(id) ?? []) {
					if (!visited.has(neighbor)) {
						visited.add(neighbor);
						queue.push(neighbor);
					}
				}
			}
			if (component.length > 0) {
				components.push(component);
			}
		}

		return components;
	}

	/**
	 * 3体クラスター合体（経路①）を試みる
	 *
	 * @param pairs - 接触ペア一覧
	 * @returns この呼び出しで合体したボディID
	 * @internal
	 */
	private tryTripleClusterFusion(pairs: Matter.Pair[]): Set<Matter.Body['id']> {
		const fused = new Set<Matter.Body['id']>();
		const components = this.buildSameLabelConnectedComponents(pairs);

		for (const component of components) {
			if (component.length !== 3) continue;
			if (
				component.some(
					(b) => this.clusterFusedBodyIds.has(b.id) || fused.has(b.id),
				)
			) {
				continue;
			}
			if (this.fusionCluster(component)) {
				for (const body of component) {
					fused.add(body.id);
					this.clusterFusedBodyIds.add(body.id);
				}
			}
		}

		return fused;
	}

	/**
	 * 3体をまとめて融合する（経路①）
	 *
	 * @param bodies - 同ラベル3体
	 * @returns 融合に成功したら true
	 * @remarks
	 * NOTE: 要求レベルが最大レベルを超える場合（例: 9×3 => level 11）は
	 * 生成物なし（消滅）で 9999 点を加算する
	 * @internal
	 */
	private fusionCluster(bodies: Matter.Body[]): boolean {
		const currentMono = this.getMonoByBody(bodies[0]);
		if (currentMono == null) return false;
		if (!bodies.every((b) => b.label === currentMono.id)) return false;
		if (
			!bodies.every((b) => this.engine.world.bodies.some((w) => w.id === b.id))
		) {
			return false;
		}

		const requestedTargetLevel = currentMono.level + 2;
		const maxLevel = this.getMaxMonoLevel();
		const isOverflowFusion = requestedTargetLevel > maxLevel;
		const nextMono = isOverflowFusion
			? null
			: (this.monoDefinitions.find((m) => m.level === requestedTargetLevel) ??
				null);
		if (!isOverflowFusion && nextMono == null) return false;

		const newX =
			bodies.reduce((sum, b) => sum + b.position.x, 0) / bodies.length;
		const newY =
			bodies.reduce((sum, b) => sum + b.position.y, 0) / bodies.length;

		this.removeBodiesForFusion(...bodies);

		let additionalScore: number;
		if (isOverflowFusion) {
			this.advanceFusionCombo();
			additionalScore = this.fusionPairScore(currentMono, true);
		} else {
			if (nextMono == null) return false;
			this.advanceFusionCombo();
			const score1 = this.fusionPairScore(currentMono, false);
			this.advanceFusionCombo();
			const score2 = this.fusionPairScore(currentMono, false);
			additionalScore = score1 + score2;
			this.addFusionProductBody(nextMono, newX, newY);
		}
		this.score += additionalScore;
		this.emit('fusioned', newX, newY, nextMono, additionalScore);
		return true;
	}

	/**
	 * 追いつき合体（経路②）を試みる
	 *
	 * @param bodyA - 接触ボディA
	 * @param bodyB - 接触ボディB
	 * @returns 追いつき合体したら true
	 * @internal
	 */
	private tryFusionCatchUp(bodyA: Matter.Body, bodyB: Matter.Body): boolean {
		const entryA = this.recentSpecialFusions.find(
			(x) => x.bodyId === bodyA.id && x.expiresFrame > this.frame,
		);
		if (entryA != null && this.fusionCatchUp(bodyB, bodyA, entryA)) {
			return true;
		}

		const entryB = this.recentSpecialFusions.find(
			(x) => x.bodyId === bodyB.id && x.expiresFrame > this.frame,
		);
		if (entryB != null && this.fusionCatchUp(bodyA, bodyB, entryB)) {
			return true;
		}

		return false;
	}

	/**
	 * 登録済み生成物への追いつき合体を実行する（経路②）
	 *
	 * @param catcherBody - productLevel-1 のボディ
	 * @param productBody - 登録済み生成物
	 * @param entry - 追いつき登録情報
	 * @returns 融合に成功したら true
	 * @internal
	 */
	private fusionCatchUp(
		catcherBody: Matter.Body,
		productBody: Matter.Body,
		entry: {
			bodyId: Matter.Body['id'];
			productLevel: number;
			expiresFrame: number;
		},
	): boolean {
		if (entry.expiresFrame <= this.frame) return false;
		if (
			!this.engine.world.bodies.some((b) => b.id === catcherBody.id) ||
			!this.engine.world.bodies.some((b) => b.id === productBody.id)
		) {
			return false;
		}

		const catcherMono = this.getMonoByBody(catcherBody);
		if (catcherMono == null || catcherMono.level !== entry.productLevel - 1) {
			return false;
		}

		const requestedTargetLevel = entry.productLevel + 1;
		const maxLevel = this.getMaxMonoLevel();
		const isOverflowFusion = requestedTargetLevel > maxLevel;
		const nextMono = isOverflowFusion
			? null
			: (this.monoDefinitions.find((m) => m.level === requestedTargetLevel) ??
				null);
		if (!isOverflowFusion && nextMono == null) return false;

		const newX = (catcherBody.position.x + productBody.position.x) / 2;
		const newY = (catcherBody.position.y + productBody.position.y) / 2;

		this.unregisterSpecialFusion(productBody.id);
		this.removeBodiesForFusion(catcherBody, productBody);

		this.advanceFusionCombo();
		const additionalScore = this.fusionPairScore(catcherMono, isOverflowFusion);
		this.score += additionalScore;

		if (nextMono) {
			this.addFusionProductBody(nextMono, newX, newY);
		}
		this.emit('fusioned', newX, newY, nextMono, additionalScore);
		return true;
	}

	//#endregion

	private fusion(bodyA: Matter.Body, bodyB: Matter.Body) {
		if (
			!this.engine.world.bodies.some((b) => b.id === bodyA.id) ||
			!this.engine.world.bodies.some((b) => b.id === bodyB.id)
		) {
			return;
		}

		this.advanceFusionCombo();

		const newX = (bodyA.position.x + bodyB.position.x) / 2;
		const newY = (bodyA.position.y + bodyB.position.y) / 2;

		this.removeBodiesForFusion(bodyA, bodyB);

		const currentMono = this.monoDefinitions.find((y) => y.id === bodyA.label);

		if (currentMono == null) {
			throw new Error('Current Mono Not Found');
		}

		const nextMono =
			this.monoDefinitions.find((x) => x.level === currentMono.level + 1) ??
			null;

		if (nextMono) {
			this.addFusionProductBody(nextMono, newX, newY);
		}

		const additionalScore = this.fusionPairScore(
			currentMono,
			nextMono == null && this.gameMode !== 'yen' && this.gameMode !== 'sweets',
		);
		this.score += additionalScore;

		this.emit('fusioned', newX, newY, nextMono, additionalScore);
	}

	private onCollision(event: Matter.IEventCollision<Matter.Engine>) {
		const clusterFused = this.tryTripleClusterFusion(event.pairs);

		for (const pairs of event.pairs) {
			const { bodyA, bodyB } = pairs;

			if (clusterFused.has(bodyA.id) || clusterFused.has(bodyB.id)) continue;

			if (this.tryFusionCatchUp(bodyA, bodyB)) continue;

			const shouldFusion =
				bodyA.label === bodyB.label &&
				!this.fusionReservedPairs.some(
					(x) =>
						x.bodyA.id === bodyA.id ||
						x.bodyA.id === bodyB.id ||
						x.bodyB.id === bodyA.id ||
						x.bodyB.id === bodyB.id,
				);

			if (shouldFusion) {
				if (
					this.fusionReadyBodyIds.includes(bodyA.id) &&
					this.fusionReadyBodyIds.includes(bodyB.id)
				) {
					this.fusion(bodyA, bodyB);
				} else {
					this.fusionReservedPairs.push({ bodyA, bodyB });
					this.tickCallbackQueue.push({
						frame: this.frame + this.msToFrame(this.FUSION_RESERVE_MS),
						callback: () => {
							this.fusionReservedPairs = this.fusionReservedPairs.filter(
								(x) => x.bodyA.id !== bodyA.id && x.bodyB.id !== bodyB.id,
							);
							this.fusion(bodyA, bodyB);
						},
					});
				}
			} else {
				const energy = pairs.collision.depth;

				if (bodyA.label === '_overflow_' || bodyB.label === '_overflow_') continue;

				if (bodyA.label !== '_wall_' && bodyB.label !== '_wall_') {
					if (!this.gameOverReadyBodyIds.includes(bodyA.id)) this.gameOverReadyBodyIds.push(bodyA.id);
					if (!this.gameOverReadyBodyIds.includes(bodyB.id)) this.gameOverReadyBodyIds.push(bodyB.id);
				}

				this.emit('collision', energy, bodyA, bodyB);
			}
		}
	}

	private onCollisionActive(event: Matter.IEventCollision<Matter.Engine>) {
		for (const pairs of event.pairs) {
			const { bodyA, bodyB } = pairs;

			// ハコからあふれたかどうかの判定
			if (
				bodyA.id === this.overflowCollider.id ||
				bodyB.id === this.overflowCollider.id
			) {
				const other = bodyA.id === this.overflowCollider.id ? bodyB : bodyA;
				if (this.gameOverReadyBodyIds.includes(other.id)) {
					this.handleOverflow(other);
					if (this.isGameOver) break;
				}
				continue;
			}
		}

		this.tryTripleClusterFusion(event.pairs);

		for (const pairs of event.pairs) {
			const { bodyA, bodyB } = pairs;
			if (
				this.clusterFusedBodyIds.has(bodyA.id) ||
				this.clusterFusedBodyIds.has(bodyB.id)
			) {
				continue;
			}
			this.tryFusionCatchUp(bodyA, bodyB);
		}
	}

	public surrender() {
		this.logs.push({
			frame: this.frame,
			operation: 'surrender',
		});

		this.finalizeGameOver();
	}

	private handleOverflow(body: Matter.Body) {
		if (!this.lostLifeThisDrop) {
			this.lostLifeThisDrop = true;
			this.dropsSinceLifeLost = 0;
			if (this.lives > 1) {
				this.lives--;
				this.removeOverflowBodies(body);
			} else {
				this.lives--;
				this.finalizeGameOver();
			}
		} else {
			this.removeOverflowBodies(body);
		}
	}

	private removeOverflowBodies(target: Matter.Body) {
		if (target.label === '_wall_' || target.label === '_overflow_') return;
		this.fusionReadyBodyIds = this.fusionReadyBodyIds.filter(
			(x) => x !== target.id,
		);
		this.gameOverReadyBodyIds = this.gameOverReadyBodyIds.filter(
			(x) => x !== target.id,
		);
		Matter.Composite.remove(this.engine.world, target);

		// 念のため残っているオーバーフロー中のオブジェクトも除去する
		for (const b of [...this.engine.world.bodies]) {
			if (
				b.label === '_wall_' ||
				b.label === '_overflow_' ||
				b.id === target.id
			) continue;
			const collision = Matter.SAT.collides(b, this.overflowCollider);
			if ((collision && collision.collided) || b.bounds.min.y < 0) {
				this.fusionReadyBodyIds = this.fusionReadyBodyIds.filter(
					(x) => x !== b.id,
				);
				this.gameOverReadyBodyIds = this.gameOverReadyBodyIds.filter(
					(x) => x !== b.id,
				);
				Matter.Composite.remove(this.engine.world, b);
			}
		}
	}

	private finalizeGameOver() {
		this.isGameOver = true;
		this.emit('gameOver');
	}

	public start() {
		this.lostLifeThisDrop = false;
		this.dropsSinceLifeLost = 0;
		this.emit('changeLives', this.lives);
		for (let i = 0; i < this.STOCK_MAX; i++) {
			this.stock.push(this.createStockItem());
		}
		this.emit('changeStock', this.stock);

		Matter.Events.on(
			this.engine,
			'collisionStart',
			this.onCollision.bind(this),
		);
		Matter.Events.on(
			this.engine,
			'collisionActive',
			this.onCollisionActive.bind(this),
		);
	}

	public getLogs() {
		return this.logs;
	}

	public tick() {
		this.frame++;
		this.clusterFusedBodyIds.clear();

		if (this.latestFusionedAt < this.frame - this.COMBO_INTERVAL) {
			this.combo = 0;
		}

		this.cleanupExpiredSpecialFusions();

		this.tickCallbackQueue = this.tickCallbackQueue.filter((x) => {
			if (x.frame === this.frame) {
				x.callback();
				return false;
			} else {
				return true;
			}
		});

		Matter.Engine.update(this.engine, this.TICK_DELTA);

		const hasNextTick = !this.isGameOver;

		return hasNextTick;
	}

	public getActiveMonos() {
		return this.engine.world.bodies
			.map((x) => this.monoDefinitions.find((mono) => mono.id === x.label))
			.filter((x) => x !== undefined);
	}

	public drop(_x: number) {
		if (this.isGameOver) return;
		if (this.frame - this.latestDroppedAt < this.DROP_COOLTIME) return;

		const head = this.stock.shift();
		if (!head) return;

		this.stock.push(this.createStockItem());
		this.emit('changeStock', this.stock);

		const inputX = Math.round(_x);
		const x = Math.min(
			this.GAME_WIDTH - this.PLAYAREA_MARGIN - head.mono.sizeX / 2,
			Math.max(this.PLAYAREA_MARGIN + head.mono.sizeX / 2, inputX),
		);
		const body = this.createBody(head.mono, x, 50 + head.mono.sizeY / 2);
		this.logs.push({
			frame: this.frame,
			operation: 'drop',
			x: inputX,
		});

		// add force
		if (this.gameMode === 'space') {
			Matter.Body.applyForce(body, body.position, {
				x: 0,
				y: (Math.PI * head.mono.sizeX * head.mono.sizeY) / 65536,
			});
		}

		Matter.Composite.add(this.engine.world, body);
		this.lostLifeThisDrop = false;
		if (this.lives < 3) {
			this.dropsSinceLifeLost++;
			if (this.dropsSinceLifeLost >= 10) {
				this.lives = Math.min(3, this.lives + 1);
				this.dropsSinceLifeLost = 0;
			}
		}

		this.fusionReadyBodyIds.push(body.id);
		this.latestDroppedAt = this.frame;

		this.emit('dropped', x);
		this.emit('monoAdded', head.mono);
	}

	public hold() {
		if (this.isGameOver) return;

		this.logs.push({
			frame: this.frame,
			operation: 'hold',
		});

		if (this.holding) {
			const head = this.stock.shift();
			if (!head) return;
			this.stock.unshift(this.holding);
			this.holding = head;
			this.emit('changeHolding', this.holding);
			this.emit('changeStock', this.stock);
		} else {
			const head = this.stock.shift();
			if (!head) return;
			this.holding = head;
			this.stock.push(this.createStockItem());
			this.emit('changeHolding', this.holding);
			this.emit('changeStock', this.stock);
		}
	}

	public static serializeLogs(logs: Log[]) {
		const _logs: number[][] = [];

		for (let i = 0; i < logs.length; i++) {
			const log = logs[i];
			const frameDelta = i === 0 ? log.frame : log.frame - logs[i - 1].frame;

			switch (log.operation) {
				case 'drop':
					_logs.push([frameDelta, 0, log.x]);
					break;
				case 'hold':
					_logs.push([frameDelta, 1]);
					break;
				case 'surrender':
					_logs.push([frameDelta, 2]);
					break;
			}
		}

		return _logs;
	}

	public static deserializeLogs(logs: number[][]) {
		const _logs: Log[] = [];

		let frame = 0;

		for (const log of logs) {
			const frameDelta = log[0];
			frame += frameDelta;

			const operation = log[1];

			switch (operation) {
				case 0:
					_logs.push({
						frame,
						operation: 'drop',
						x: log[2],
					});
					break;
				case 1:
					_logs.push({
						frame,
						operation: 'hold',
					});
					break;
				case 2:
					_logs.push({
						frame,
						operation: 'surrender',
					});
					break;
			}
		}

		return _logs;
	}

	public dispose() {
		Matter.World.clear(this.engine.world, false);
		Matter.Engine.clear(this.engine);
	}
}
