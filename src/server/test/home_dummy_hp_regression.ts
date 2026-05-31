import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { GlobalState } from "../core/GlobalState";
import { EntityState, EntityTeam } from "../core/Entity";
import { BitBuffer } from "../network/protocol/bitBuffer";
import { CombatHandler } from "../handlers/CombatHandler";
import { LevelHandler } from "../handlers/LevelHandler";
import { parseSwz } from "../scripts/swzPatchUtils";

const TARGET_HP = "1000000";
const TARGET_DUMMIES = ["HomeDummy1", "HomeDummy2", "HomeDummy3"];

function repoPath(...parts: string[]): string {
  return path.resolve(__dirname, "..", "..", "..", ...parts);
}

function readServerEntTypes(): Array<{ EntName?: string; HitPoints?: string }> {
  const jsonPath = repoPath("src", "server", "data", "EntTypes.json");
  const raw = fs.readFileSync(jsonPath, "utf8").replace(/^\ufeff/, "");
  const data = JSON.parse(raw);
  return data.EntTypes.EntType;
}

function getLoginSwzEntTypesXml(): string {
  const swzPath = repoPath("src", "client", "content", "localhost", "p", "cbp", "Login.swz");
  const chunk = parseSwz(swzPath).chunks.find((entry) => entry.xml.includes("<EntTypes"));
  assert.ok(chunk, "Login.swz should contain EntTypes");
  return chunk.xml;
}

function getXmlHomeDummyHp(xml: string, entName: string): string {
  const match = xml.match(new RegExp(`<EntType EntName="${entName}"[^>]*>[\\s\\S]*?<HitPoints>(\\d+)<\\/HitPoints>`));
  assert.ok(match, `${entName} should exist in Login.swz EntTypes`);
  return match[1];
}

function testServerHomeDummyHp(): void {
  const entTypes = readServerEntTypes();
  for (const entName of TARGET_DUMMIES) {
    const entType = entTypes.find((entry) => entry.EntName === entName);
    assert.ok(entType, `${entName} should exist in server EntTypes`);
    assert.equal(entType.HitPoints, TARGET_HP, `${entName} server HitPoints`);
  }
}

function testLoginSwzHomeDummyHp(): void {
  const xml = getLoginSwzEntTypesXml();
  for (const entName of TARGET_DUMMIES) {
    assert.equal(getXmlHomeDummyHp(xml, entName), TARGET_HP, `${entName} Login.swz HitPoints`);
  }
}

function createDestroyEntityPayload(entityId: number): Buffer {
  const bb = new BitBuffer(false);
  bb.writeMethod4(entityId);
  bb.writeMethod15(true);
  return bb.toBuffer();
}

function createDeadStatePayload(entityId: number): Buffer {
  const bb = new BitBuffer(false);
  bb.writeMethod4(entityId);
  bb.writeMethod45(0);
  bb.writeMethod45(0);
  bb.writeMethod45(0);
  bb.writeMethod6(EntityState.DEAD, 2);
  bb.writeMethod15(false);
  bb.writeMethod15(false);
  bb.writeMethod15(false);
  bb.writeMethod15(false);
  bb.writeMethod15(false);
  bb.writeMethod15(false);
  return bb.toBuffer();
}

function createHomeDummyClient(entity: any): any {
  const sentPackets: Array<{ id: number; data: Buffer }> = [];
  return {
    character: { name: "Tester" },
    currentLevel: "CraftTown",
    currentRoomId: 1,
    levelInstanceId: "home-dummy-regression",
    token: 99001,
    userId: 99001,
    playerSpawned: true,
    clientEntID: 1,
    entities: new Map<number, any>([
      [entity.id, entity]
    ]),
    entityIdAliases: new Map(),
    knownEntityIds: new Set<number>([entity.id]),
    sentPackets,
    send(id: number, data: Buffer) {
      sentPackets.push({ id, data });
    }
  };
}

async function testHomeDummyDestroyIsRejected(): Promise<void> {
  const entity = {
    id: 7001,
    name: "HomeDummy1",
    isPlayer: false,
    team: EntityTeam.ENEMY,
    x: 100,
    y: 200,
    v: 0,
    entState: EntityState.ACTIVE,
    dead: false,
    clientSpawned: true,
    ownerToken: 99001,
    roomId: 1
  };
  const client = createHomeDummyClient(entity);
  const scope = "CraftTown#home-dummy-regression";
  GlobalState.levelEntities.set(scope, new Map([[entity.id, entity]]));

  await CombatHandler.handleEntityDestroy(client as never, createDestroyEntityPayload(entity.id));

  assert.equal(client.entities.has(entity.id), true, "HomeDummy destroy should not delete local entity");
  assert.equal(GlobalState.levelEntities.get(scope)?.has(entity.id), true, "HomeDummy destroy should not delete scoped entity");
  assert.equal(entity.entState, EntityState.ACTIVE, "HomeDummy destroy should restore active state");
  assert.equal(entity.dead, false, "HomeDummy destroy should not mark dead");
  assert.ok(client.sentPackets.some((packet: { id: number }) => packet.id === 0x0F), "HomeDummy should be re-sent after rejected destroy");
  GlobalState.levelEntities.delete(scope);
}

function testHomeDummyDeadStateIsRejected(): void {
  const entity = {
    id: 7002,
    name: "HomeDummy2",
    isPlayer: false,
    team: EntityTeam.ENEMY,
    x: 100,
    y: 200,
    v: 0,
    entState: EntityState.ACTIVE,
    dead: false,
    clientSpawned: true,
    ownerToken: 99001,
    roomId: 1
  };
  const client = createHomeDummyClient(entity);
  const scope = "CraftTown#home-dummy-regression";
  GlobalState.levelEntities.set(scope, new Map([[entity.id, entity]]));

  LevelHandler.handleEntityIncrementalUpdate(client as never, createDeadStatePayload(entity.id));

  assert.equal(entity.entState, EntityState.ACTIVE, "HomeDummy dead movement state should be restored");
  assert.equal(entity.dead, false, "HomeDummy dead movement state should not mark dead");
  assert.ok(client.sentPackets.some((packet: { id: number }) => packet.id === 0x0F), "HomeDummy should be re-sent after rejected dead state");
  GlobalState.levelEntities.delete(scope);
}

async function main(): Promise<void> {
  testServerHomeDummyHp();
  testLoginSwzHomeDummyHp();
  await testHomeDummyDestroyIsRejected();
  testHomeDummyDeadStateIsRejected();

  console.log("home_dummy_hp_regression: ok");
}

main().catch((error) => {
  console.error("home_dummy_hp_regression: failed");
  console.error(error);
  process.exitCode = 1;
});
