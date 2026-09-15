/*
 * WhatsApp send-throttle — anti-ban pacing contract tests.
 *
 * The throttle is what stands between a bulk campaign and a banned number:
 * random 5–10 s gaps between EVERY message and a long rest after every N.
 * There are NO volume caps — the mahallu decides its own volume; pacing
 * only. Counters survive app restarts. Clock, sleep and persistence are
 * injected, so these tests run with a manual clock — no timers, no disk.
 */
import { describe, it, expect } from "vitest";
import { SendThrottle } from "./whatsapp-throttle";

function harness(config: Partial<SendThrottle["config"]> = {}, saved: any = null) {
  let now = 1_700_000_000_000;
  const sleeps: number[] = [];
  let persisted: any = saved;
  const throttle = new SendThrottle({
    config,
    now: () => now,
    sleep: async (ms: number) => { now += ms; sleeps.push(ms); },
    load: () => persisted,
    save: (d) => { persisted = d; },
  });
  return {
    throttle,
    advance: (ms: number) => { now += ms; },
    now: () => now,
    sleeps,
    persisted: () => persisted,
  };
}

describe("send throttle — human-like pacing", () => {
  it("first send never waits", async () => {
    const h = harness();
    await expect(h.throttle.beforeSend()).resolves.toBeUndefined();
    expect(h.sleeps).toHaveLength(0);
  });

  it("back-to-back sends wait a jittered gap inside the configured window", async () => {
    const h = harness({ minGapMs: 5_000, maxGapMs: 10_000 });
    h.throttle.recordSent();
    await expect(h.throttle.beforeSend()).resolves.toBeUndefined();
    expect(h.sleeps).toHaveLength(1);
    expect(h.sleeps[0]).toBeGreaterThanOrEqual(5_000);
    expect(h.sleeps[0]).toBeLessThanOrEqual(10_000);
  });

  it("jitter never leaves the window across many sends", async () => {
    const h = harness({ minGapMs: 2_000, maxGapMs: 3_000 });
    for (let i = 0; i < 12; i++) {
      await h.throttle.beforeSend();
      h.throttle.recordSent();
    }
    expect(h.sleeps.length).toBeGreaterThanOrEqual(11);
    for (const s of h.sleeps) {
      expect(s).toBeGreaterThanOrEqual(2_000);
      expect(s).toBeLessThanOrEqual(3_000);
    }
  });

  it("takes the long rest after every N sends (bulk rest)", async () => {
    const h = harness({ minGapMs: 1_000, maxGapMs: 1_000, restEvery: 3, restMs: 60_000 });
    for (let i = 0; i < 3; i++) { await h.throttle.beforeSend(); h.throttle.recordSent(); }
    h.sleeps.length = 0;
    // 4th message: sinceRest === 3 → rest applies
    await expect(h.throttle.beforeSend()).resolves.toBeUndefined();
    expect(h.sleeps[0]).toBe(60_000);
  });

  it("the rest counter resets after a rest, so the next N sends pace normally", async () => {
    const h = harness({ minGapMs: 1_000, maxGapMs: 1_000, restEvery: 3, restMs: 60_000 });
    for (let i = 0; i < 3; i++) { await h.throttle.beforeSend(); h.throttle.recordSent(); }
    await h.throttle.beforeSend(); // the rest (waits 60 s, resets sinceRest)
    h.throttle.recordSent();
    h.sleeps.length = 0;
    // Messages 5 and 6: plain jitter again, no rest until sinceRest hits 3.
    for (let i = 0; i < 2; i++) { await h.throttle.beforeSend(); h.throttle.recordSent(); }
    expect(h.sleeps).toHaveLength(2);
    for (const s of h.sleeps) expect(s).toBe(1_000);
    // Message 7: rest due again.
    await h.throttle.beforeSend();
    expect(h.sleeps[2]).toBe(60_000);
  });

  it("no rest on the very first sends (sinceRest 0 is never a rest point)", async () => {
    const h = harness({ minGapMs: 500, maxGapMs: 500, restEvery: 1, restMs: 60_000 });
    await expect(h.throttle.beforeSend()).resolves.toBeUndefined();
    expect(h.sleeps).toHaveLength(0);
  });

  it("a long wait between sends carries over — only the remainder is slept", async () => {
    const h = harness({ minGapMs: 5_000, maxGapMs: 5_000 });
    h.throttle.recordSent();
    h.advance(2_000); // 2 s already passed since the last send
    await h.throttle.beforeSend();
    expect(h.sleeps[0]).toBe(3_000);
  });
});

describe("send throttle — no volume caps", () => {
  it("never refuses a send, no matter how many went out today", async () => {
    const h = harness({ minGapMs: 10, maxGapMs: 10, restEvery: 0 });
    for (let i = 0; i < 300; i++) {
      await expect(h.throttle.beforeSend()).resolves.toBeUndefined();
      h.throttle.recordSent();
    }
    expect(h.throttle.snapshot().sentToday).toBe(300);
  });

  it("sending past the old 50/hour and 250/day limits just keeps pacing", async () => {
    const h = harness({ minGapMs: 10, maxGapMs: 10, restEvery: 20, restMs: 40 });
    for (let i = 0; i < 260; i++) {
      await h.throttle.beforeSend(); // would have paused at 50 and 250 before
      h.throttle.recordSent();
    }
    expect(h.throttle.snapshot()).toEqual({ sentToday: 260 });
  });
});

describe("send throttle — persistence", () => {
  it("persists counters after every send", () => {
    const h = harness();
    h.throttle.recordSent();
    h.throttle.recordSent();
    const p = h.persisted();
    expect(p.sinceRest).toBe(2);
    expect(p.dayCount).toBe(2);
    expect(p.lastSentAt).toBeGreaterThan(0);
    expect(typeof p.dayKey).toBe("string");
  });

  it("a restarted app cannot skip a due rest (counters reload from disk)", async () => {
    const first = harness({ restEvery: 5, minGapMs: 100, maxGapMs: 100, restMs: 60_000 });
    for (let i = 0; i < 5; i++) first.throttle.recordSent();
    // "Restart": new instance loading what the first one saved — the 6th
    // send must still owe the long rest.
    const restarted = harness({ restEvery: 5, minGapMs: 100, maxGapMs: 100, restMs: 60_000 }, first.persisted());
    restarted.advance(1_000); // 1 s already elapsed since the last send
    await restarted.throttle.beforeSend();
    expect(restarted.sleeps[0]).toBe(59_000); // only the remainder of the rest
  });

  it("a counter file written by the older capped build still loads", async () => {
    // Old shape: { hourKey, hourCount, dayKey, dayCount, lastSentAt }.
    const d = new Date(1_700_000_000_000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const saved = { hourKey: 4711, hourCount: 37, dayKey: key, dayCount: 41, lastSentAt: 1_700_000_000_000 };
    const h = harness({}, saved);
    const snap = h.throttle.snapshot();
    expect(snap.sentToday).toBe(41); // today's count carries over
    await expect(h.throttle.beforeSend()).resolves.toBeUndefined(); // foreign shape must not throw
  });
});

describe("send throttle — status snapshot", () => {
  it("reports how many messages went out today (no cap to compare against)", () => {
    const h = harness();
    h.throttle.recordSent();
    h.throttle.recordSent();
    h.throttle.recordSent();
    expect(h.throttle.snapshot()).toEqual({ sentToday: 3 });
  });

  it("the daily counter rolls back to zero on a new local day", () => {
    const h = harness();
    h.throttle.recordSent();
    h.advance(24 * 3_600_000); // next local day
    expect(h.throttle.snapshot()).toEqual({ sentToday: 0 });
  });
});
