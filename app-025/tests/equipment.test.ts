import { describe, it, expect } from 'vitest';
import {
  classifyLightByLumen,
  recommendLumens,
  recommendWatts,
  checkLight,
  filterFlowLph,
  heaterWatts,
  suggestGlassMm,
  equipmentSummary,
} from '../src/core/equipment';
import type { Item, Tank, Substrate } from '../src/core/types';

const tank: Tank = { id: 't', name: 'T', l: 100, w: 50, h: 50, glassMm: 10, waterLevelMm: 450, openTop: true };
const sub: Substrate = { kind: 'soil', densityKgPerL: 1.05, thicknessMm: 50, slopeMm: 60 };

function plant(name: string, lightNeed: 'low' | 'mid' | 'high'): Item {
  return { id: name, kind: 'plant', name, x: 0, y: 0, scaleCm: 10, rotDeg: 0, lightNeed };
}

describe('光照判定', () => {
  it('流明/面积 → 低/中/高，边界归入较高档', () => {
    // 面积 0.5m²
    expect(classifyLightByLumen(70, 0.5)).toBe('low'); // 140 lm/m²
    expect(classifyLightByLumen(75, 0.5)).toBe('mid'); // 150
    expect(classifyLightByLumen(190, 0.5)).toBe('mid'); // 380
    expect(classifyLightByLumen(200, 0.5)).toBe('high'); // 400
  });

  it('推荐流明与功率随有效水量缩放', () => {
    expect(recommendLumens('mid', 0.5)).toBe(Math.round(275 * 0.5));
    expect(recommendLumens('high', 0.5)).toBe(Math.round(500 * 0.5));
    expect(recommendWatts('low', 100)).toBe(Math.round(0.25 * 100));
    expect(recommendWatts('high', 100)).toBe(Math.round(0.8 * 100));
  });

  it('高光草配低光 → 明确提示低光档光强不足', () => {
    const r = checkLight('low', [plant('红宫廷', 'high')]);
    expect(r.ok).toBe(false);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('当前为低光档，阳性草光强不足');
    expect(r.warnings[0]).toContain('建议提高光强或改用低光草');
  });

  it('高光草配中光 → 明确提示中光档光强不足', () => {
    const r = checkLight('mid', [plant('红宫廷', 'high')]);
    expect(r.ok).toBe(false);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('当前为中光档，阳性草光强不足');
    expect(r.warnings[0]).toContain('建议提高光强或改用低光草');
  });

  it('高光下仅有阴性草 → 爆藻警告', () => {
    const r = checkLight('high', [plant('铁皇冠', 'low')]);
    expect(r.ok).toBe(false);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('强光配阴性草易爆藻');
  });

  it('高光下同时有阳性草和阴性草 → 单独提示不要混养，不再报爆藻', () => {
    const r = checkLight('high', [plant('红宫廷', 'high'), plant('铁皇冠', 'low')]);
    expect(r.ok).toBe(false);
    expect(r.warnings).toEqual(['高光档同时养阳性草和阴性草，光照需求冲突，不建议混养']);
  });

  it('匹配时不告警', () => {
    expect(checkLight('low', [plant('小水榕', 'low')]).ok).toBe(true);
    expect(checkLight('mid', [plant('皇冠草', 'mid')]).ok).toBe(true);
    expect(checkLight('high', [plant('迷你矮珍珠', 'high')]).ok).toBe(true);
  });
});

describe('过滤与加热', () => {
  it('流量 = 5~8 倍有效水量/小时', () => {
    const f = filterFlowLph(80);
    expect(f.min).toBe(400);
    expect(f.max).toBe(640);
    expect(f.estimated).toBe(true);
  });

  it('加热棒：50L、ΔT10 → 约 60W，建议规格上取整', () => {
    const h = heaterWatts(50, 24, 34);
    expect(h.watts).toBe(60);
    expect(h.suggested).toBe(100);
    expect(h.estimated).toBe(true);
  });

  it('ΔT=0 时保底下限 25W', () => {
    const h = heaterWatts(100, 26, 26);
    expect(h.watts).toBe(25);
    expect(h.suggested).toBe(25);
  });

  it('玻璃厚度经验表', () => {
    expect(suggestGlassMm({ ...tank, h: 30 })).toBe(5);
    expect(suggestGlassMm({ ...tank, h: 45 })).toBe(8);
    expect(suggestGlassMm({ ...tank, h: 60 })).toBe(10);
    expect(suggestGlassMm({ ...tank, h: 90 })).toBe(12);
  });

  it('equipmentSummary 汇总自洽', () => {
    const s = equipmentSummary(tank, sub, [], 'mid', 24, 26);
    // 有效水量 = 100*50*45/1000 - 100*50*8/1000 = 225 - 40 = 185
    expect(s.effectiveL).toBeCloseTo(185, 6);
    expect(s.areaM2).toBeCloseTo(0.5, 9);
    expect(s.filter.min).toBe(5 * Math.floor(185));
    expect(s.heater.watts).toBe(Math.round(185 * 2 * 0.12)); // 44W（>25W 下限，无需取下限）
  });
});
