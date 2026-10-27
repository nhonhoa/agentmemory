import { describe, expect, it } from "vitest";
import { GRAPH_RETRIEVAL_DATA_SHARDS, KV } from "../src/state/schema.js";
import { createGraphIndexReader, getGraphIndexStatus, initializeGraphIndex, retrievalDataScope } from "../src/state/graph-retrieval-index.js";
import { getGraphIndexMigrationStatus } from "../src/state/graph-index-migration.js";
import { createGraphIndexState } from "./helpers/graph-index-state.js";

describe("sharded graph retrieval data", () => {
  it("maps every key to one stable shard and spreads keys across shards", () => {
    const used = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const scope = retrievalDataScope(`build:entry:${i}`);
      expect(GRAPH_RETRIEVAL_DATA_SHARDS).toContain(scope);
      expect(retrievalDataScope(`build:entry:${i}`)).toBe(scope);
      used.add(scope);
    }
    expect(used.size).toBe(GRAPH_RETRIEVAL_DATA_SHARDS.length);
  });

  it("never writes index data to the unsharded scope and reads it back from shards", async () => {
    const fixture = createGraphIndexState();
    await initializeGraphIndex(fixture.kv, { status: "ready" });
    for (let i = 0; i < 20; i++) {
      await fixture.kv.set(KV.graphNodes, `n${i}`, { id: `n${i}`, name: `Node ${i}`, type: "concept", properties: {}, sourceObservationIds: [], createdAt: "now" });
    }
    const writes = fixture.calls.filter((call) => call.id === "state::set" && call.scope.startsWith(KV.graphRetrievalData));
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every((call) => call.scope.startsWith(`${KV.graphRetrievalData}:shard:`))).toBe(true);
    expect(fixture.store.has(KV.graphRetrievalData)).toBe(false);
    const reader = (await createGraphIndexReader(fixture.kv))!;
    expect(await reader.getNode("n3")).toMatchObject({ id: "n3", name: "Node 3" });
  });

  it("treats an unsharded schema 2 index as missing so it gets rebuilt", async () => {
    const fixture = createGraphIndexState();
    await fixture.kv.set(KV.graphRetrievalControl, "current", {
      schema: 2, buildId: "legacy", status: "ready", revision: 4, nodes: 1, edges: 0, historyEdges: 0,
      incompleteRecords: 0, nodesByType: {}, edgesByType: {}, otherTypes: 0, updatedAt: "now",
    });
    expect(await getGraphIndexStatus(fixture.kv)).toBeNull();
    expect(await createGraphIndexReader(fixture.kv)).toBeNull();
    expect(await getGraphIndexMigrationStatus(fixture.kv)).toMatchObject({ state: "needs-migration", ready: false });
  });
});
