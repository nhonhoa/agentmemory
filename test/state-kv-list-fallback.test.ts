import { describe, expect, it } from "vitest";
import { StateKV, isPayloadTooLarge } from "../src/state/kv.js";

function tooLarge(): Error {
  return Object.assign(new Error("payload_too_large: Serialized JSON envelope is 35083649 bytes; limit is 16777216 bytes."), {
    code: "payload_too_large",
  });
}

function setup(rows: Record<string, unknown>, listFails: () => Error | null) {
  const calls: string[] = [];
  const sdk = {
    trigger: async ({ function_id: fn, payload }: { function_id: string; payload: { scope: string; key?: string } }) => {
      calls.push(fn);
      if (fn === "state::list") {
        const error = listFails();
        if (error) throw error;
        return Object.values(rows);
      }
      if (fn === "state::list_keys") return { keys: Object.keys(rows) };
      if (fn === "state::get") return rows[payload.key!] ?? null;
      throw new Error(`Unexpected ${fn}`);
    },
  };
  return { kv: new StateKV(sdk as never), calls };
}

describe("StateKV.list over the engine message limit", () => {
  it("reads a too-large scope key by key", async () => {
    const rows = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, { id: `k${i}` }]));
    const { kv, calls } = setup(rows, tooLarge);
    const values = await kv.list<{ id: string }>("mem:test");
    expect(values.map((v) => v.id)).toEqual(Object.keys(rows));
    expect(calls.filter((c) => c === "state::get")).toHaveLength(100);
  });

  it("does not hide other list failures", async () => {
    const { kv } = setup({ a: { id: "a" } }, () => new Error("offline"));
    await expect(kv.list("mem:test")).rejects.toThrow("offline");
  });

  it("lists keys without reading values", async () => {
    const { kv, calls } = setup({ a: 1, b: 2 }, () => null);
    expect(await kv.listKeys("mem:test")).toEqual(["a", "b"]);
    expect(calls).toEqual(["state::list_keys"]);
  });

  it("recognizes the engine error by code or message", () => {
    expect(isPayloadTooLarge(tooLarge())).toBe(true);
    expect(isPayloadTooLarge(new Error("function_not_found"))).toBe(false);
    expect(isPayloadTooLarge(null)).toBe(false);
  });
});
