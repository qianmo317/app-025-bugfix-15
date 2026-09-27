import type { Item, Tank } from './types';
import { effectiveVolumeL, waterSurfaceAreaM2 } from './volume';
import type { Substrate } from './types';

/** 光照等级：按 流明 / 水面面积(m²) 判定（经验阈值，可配） */
export type LightLevel = 'low' | 'mid' | 'high';

/** 分档上界（lm/m²）：<2500 低光、2500~5000 中光、≥5000 高光 */
export const LIGHT_MID_MIN = 2500;
export const LIGHT_HIGH_MIN = 5000;

/**
 * 光照等级参考区间（lm/m²）——分档判定与页面展示共用此表，保证口径一致：
 * 低 [0, 2500)、中 [2500, 5000)、高 [5000, ∞)。
 */
export const LIGHT_LUMEN_PER_M2: Record<LightLevel, [number, number]> = {
  low: [0, LIGHT_MID_MIN],
  mid: [LIGHT_MID_MIN, LIGHT_HIGH_MIN],
  high: [LIGHT_HIGH_MIN, Infinity],
};

/** W/L 经验区间（LED 时代）：低 0.15~0.35、中 0.35~0.6、高 0.6~1.0 */
export const WL_RANGE: Record<LightLevel, [number, number]> = {
  low: [0.15, 0.35],
  mid: [0.35, 0.6],
  high: [0.6, 1.0],
};

export function classifyLightByLumen(lumens: number, areaM2: number): LightLevel {
  const lmPerM2 = areaM2 > 0 ? lumens / areaM2 : 0;
  if (lmPerM2 < LIGHT_MID_MIN) return 'low';
  if (lmPerM2 < LIGHT_HIGH_MIN) return 'mid';
  return 'high';
}

/** 参考区间展示文案（lm/m²），与分档判定同源 */
export function formatLightRange(level: LightLevel): string {
  const [min, max] = LIGHT_LUMEN_PER_M2[level];
  if (!Number.isFinite(max)) return `${min}+`;
  return `${min}~${max}`;
}

/** 推荐灯具流明 = 目标等级中值(lm/m²) × 水面面积 */
export function recommendLumens(level: LightLevel, areaM2: number): number {
  const mid = level === 'low' ? 1500 : level === 'mid' ? 3750 : 6250;
  return Math.round(mid * areaM2);
}

/** 推荐功率(W)：按目标等级的 W/L 中值 × 有效水量 */
export function recommendWatts(level: LightLevel, effectiveL: number): number {
  const wl = level === 'low' ? 0.25 : level === 'mid' ? 0.45 : 0.8;
  return Math.round(wl * effectiveL);
}

export type LightCheck = {
  level: LightLevel;
  ok: boolean;
  warnings: string[];
};

/**
 * 光照交叉校验：水草需求 vs 实际光强。
 * - 缸内有高光草（阳性草）：
 *   · 低光 → 光强严重不足；中光 → 光强略低于需求，均建议提高光强或改用低光草。
 * - 高光档下只有阴性草（无阳性草）→ 强光配阴性草易爆藻，建议缩短光照或调低功率。
 * - 高光档下阳性草与阴性草同缸 → 两种草对光需求相反、不要混养（优先于爆藻提醒）。
 */
export function checkLight(level: LightLevel, items: Item[]): LightCheck {
  const warnings: string[] = [];
  const needHigh = items.filter((i) => i.kind === 'plant' && i.lightNeed === 'high');
  const needLow = items.filter((i) => i.kind === 'plant' && i.lightNeed === 'low');

  if (needHigh.length && level === 'low') {
    warnings.push('光强严重不足：阳性（高光）草在低光下无法生长，建议提高光强或改用低光草');
  } else if (needHigh.length && level === 'mid') {
    warnings.push('光强略低于需求：阳性（高光）草建议提高光强或改用低光草');
  }

  if (level === 'high' && needHigh.length && needLow.length) {
    warnings.push('阳性（高光）草与阴性（低光）草对光需求相反，不建议混养：强光下阴性草易爆藻，弱光则阳性草徒长');
  } else if (level === 'high' && needLow.length) {
    warnings.push('强光配阴性草易爆藻，建议缩短光照时间或调低功率');
  }

  return { level, ok: warnings.length === 0, warnings };
}

/** 过滤流量建议：5~8 倍有效水量/小时（经验值） */
export function filterFlowLph(effectiveL: number): { min: number; max: number; estimated: true } {
  return { min: Math.round(effectiveL * 5), max: Math.round(effectiveL * 8), estimated: true };
}

/** 加热棒功率：W ≈ 有效水量(L) × 温差(°C) × 0.12，下限 25W，并取市售规格上取整 */
export function heaterWatts(effectiveL: number, roomTempC: number, targetTempC: number): {
  watts: number; suggested: number; estimated: true;
} {
  const dt = Math.max(0, targetTempC - roomTempC);
  const raw = Math.max(25, effectiveL * dt * 0.12);
  const standards = [25, 50, 100, 150, 200, 300, 500];
  const suggested = standards.find((s) => s >= raw) ?? standards[standards.length - 1];
  return { watts: Math.round(raw), suggested, estimated: true };
}

/** 常见成品缸玻璃厚度推荐（mm，经验表） */
export function suggestGlassMm(tank: Tank): number {
  const h = tank.h;
  if (h <= 30) return 5;
  if (h <= 45) return 8;
  if (h <= 60) return 10;
  return 12;
}

export type EquipmentSummary = {
  effectiveL: number;
  areaM2: number;
  light: { recommendLevel: LightLevel; lumens: number; watts: number };
  filter: { min: number; max: number };
  heater: { watts: number; suggested: number };
};

export function equipmentSummary(tank: Tank, sub: Substrate, items: Item[], targetLevel: LightLevel, roomTempC: number, targetTempC: number): EquipmentSummary {
  const eff = effectiveVolumeL(tank, sub, items);
  const area = waterSurfaceAreaM2(tank);
  const flow = filterFlowLph(eff);
  return {
    effectiveL: eff,
    areaM2: area,
    light: {
      recommendLevel: targetLevel,
      lumens: recommendLumens(targetLevel, area),
      watts: recommendWatts(targetLevel, eff),
    },
    filter: { min: flow.min, max: flow.max },
    heater: heaterWatts(eff, roomTempC, targetTempC),
  };
}
