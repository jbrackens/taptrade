import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  format24hRange,
  resolveChartSeries,
  samplePath,
} from "../components/prediction/market-chart-state";

const base = {
  currentPricePoints: 62,
  syntheticSeed: "FED-CUT-MAY26-yes",
  range: "1D",
};

describe("market chart states (honest by default)", () => {
  it("loading: no line is drawn while the fetch is in flight", () => {
    const r = resolveChartSeries({
      ...base,
      fetchStatus: "loading",
      realValues: null,
      syntheticFallbackEnabled: false,
    });
    assert.equal(r.state, "loading");
    assert.deepEqual(r.values, []);
  });

  it("error: no line is drawn when the fetch failed", () => {
    const r = resolveChartSeries({
      ...base,
      fetchStatus: "error",
      realValues: null,
      syntheticFallbackEnabled: false,
    });
    assert.equal(r.state, "error");
    assert.deepEqual(r.values, []);
  });

  it("empty: a market with no points draws a flat line at the real price", () => {
    const r = resolveChartSeries({
      ...base,
      fetchStatus: "success",
      realValues: [],
      syntheticFallbackEnabled: false,
    });
    assert.equal(r.state, "empty");
    assert.deepEqual(r.values, [62, 62]);
  });

  it("empty: a market with points but no movement draws a flat line at the real price", () => {
    const r = resolveChartSeries({
      ...base,
      fetchStatus: "success",
      realValues: [55, 55, 55, 55],
      syntheticFallbackEnabled: false,
    });
    assert.equal(r.state, "empty");
    assert.deepEqual(r.values, [62, 62]);
  });

  it("ready: real moving history renders as-is", () => {
    const real = [48, 52, 57, 62];
    const r = resolveChartSeries({
      ...base,
      fetchStatus: "success",
      realValues: real,
      syntheticFallbackEnabled: false,
    });
    assert.equal(r.state, "ready");
    assert.deepEqual(r.values, real);
  });

  it("never returns the synthetic walk when the flag is unset", () => {
    const synthetic = samplePath(base.syntheticSeed, base.range, 62);
    const cases = [
      { fetchStatus: "loading" as const, realValues: null },
      { fetchStatus: "error" as const, realValues: null },
      { fetchStatus: "success" as const, realValues: [] },
      { fetchStatus: "success" as const, realValues: [55, 55, 55] },
    ];
    for (const c of cases) {
      const r = resolveChartSeries({
        ...base,
        ...c,
        syntheticFallbackEnabled: false,
      });
      assert.notDeepEqual(r.values, synthetic);
      // The honest fallbacks are nothing-at-all or a flat line at the real
      // price — never more than two points of fabricated shape.
      assert.ok(r.values.length <= 2);
    }
  });

  it("demo flag on: keeps the pre-flag synthetic fallback exactly", () => {
    const synthetic = samplePath(base.syntheticSeed, base.range, 62);
    for (const c of [
      { fetchStatus: "loading" as const, realValues: null },
      { fetchStatus: "error" as const, realValues: null },
      { fetchStatus: "success" as const, realValues: [55, 55, 55] },
    ]) {
      const r = resolveChartSeries({
        ...base,
        ...c,
        syntheticFallbackEnabled: true,
      });
      assert.equal(r.state, "ready");
      assert.deepEqual(r.values, synthetic);
    }
  });

  it("demo flag on: real moving history still wins over the walk", () => {
    const real = [48, 52, 57, 62];
    const r = resolveChartSeries({
      ...base,
      fetchStatus: "success",
      realValues: real,
      syntheticFallbackEnabled: true,
    });
    assert.equal(r.state, "ready");
    assert.deepEqual(r.values, real);
  });
});

describe("24h range stat", () => {
  it("hides the stat when either bound is missing instead of inventing one", () => {
    assert.equal(format24hRange(undefined, undefined), null);
    assert.equal(format24hRange(58, undefined), null);
    assert.equal(format24hRange(undefined, 64), null);
  });

  it("formats real bounds", () => {
    assert.equal(format24hRange(58, 64), "58 – 64 pts");
  });
});

// 2026-07-12 integrity fix: synthetic series must be flagged so the UI can
// label them ("Simulated data" chip) — the demo deploy previously rendered
// synthetic walks indistinguishable from real history.
import { describe as describeSynth, it as itSynth } from "node:test";
import assertSynth from "node:assert/strict";

describeSynth("resolveChartSeries — synthetic flagging", () => {
  const base = {
    currentPricePoints: 42,
    syntheticSeed: "T-1-yes",
    range: "1d",
  };

  itSynth("flags the demo-mode synthetic walk", () => {
    const r = resolveChartSeries({
      ...base,
      fetchStatus: "loading",
      realValues: null,
      syntheticFallbackEnabled: true,
    });
    assertSynth.equal(r.state, "ready");
    assertSynth.equal(r.synthetic, true);
  });

  itSynth("never flags real history, even in demo mode", () => {
    const r = resolveChartSeries({
      ...base,
      fetchStatus: "success",
      realValues: [40, 41, 43],
      syntheticFallbackEnabled: true,
    });
    assertSynth.equal(r.synthetic, false);
    assertSynth.deepEqual(r.values, [40, 41, 43]);
  });

  itSynth("never flags honest states with the flag off", () => {
    for (const fetchStatus of ["loading", "error"] as const) {
      const r = resolveChartSeries({
        ...base,
        fetchStatus,
        realValues: null,
        syntheticFallbackEnabled: false,
      });
      assertSynth.equal(r.synthetic, false);
    }
    const empty = resolveChartSeries({
      ...base,
      fetchStatus: "success",
      realValues: [42, 42],
      syntheticFallbackEnabled: false,
    });
    assertSynth.equal(empty.state, "empty");
    assertSynth.equal(empty.synthetic, false);
  });
});
