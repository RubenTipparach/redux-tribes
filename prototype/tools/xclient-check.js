// Cross-client determinism check (requires playwright):
//   NODE_PATH=<playwright> node prototype/tools/xclient-check.js
// Resolves identical orders in Node and Chromium and compares turn hashes.
// Cross-client determinism: resolve the SAME orders in Node and in Chromium
// (separate processes, separate JS runtimes) and compare per-turn hashes.
const { chromium } = require("playwright");
const path = require("path").join(__dirname, "..");
const sim = require(path + "/sim/sim.js");
const { V } = require(path + "/sim/dmath.js");
const fs = require("fs");

// A collision-heavy scenario: everyone converges on the same point.
const SPEC = {
  player: [
    { classKey: "terran_frigate", pos: [-30, 0, 0], facing: [1, 0, 0] },
    { classKey: "rogue_frigate", pos: [-25, 6, -20], facing: [1, 0, 0] },
  ],
  enemy: [
    { classKey: "karisen_frigate", pos: [30, 0, 2], facing: [-1, 0, 0] },
    { classKey: "benefactor_frigate", pos: [28, -5, 18], facing: [-1, 0, 0] },
  ],
};
const ORDERS = [
  { P1: { move: { mode: "MOVE_AND_TURN", target: [10, 0, 0] }, weapons: [{ weaponIndex: 0, second: 2, targetShipId: "E1" }] },
    P2: { move: { mode: "MOVE_AND_TURN", target: [5, 0, 0] }, board: "E1" } },
  { P1: { move: { mode: "FULL_SPEED" }, weapons: [{ weaponIndex: 1, second: 10, targetShipId: "E2" }] } },
  { P1: { move: { mode: "MOVE_AND_TURN", target: [0, 0, 0] } }, P2: { move: { mode: "TURN_SLIDE" } } },
];

function runNode() {
  const st = sim.createSkirmish("xclient-1", {
    player: SPEC.player.map(s => ({ classKey: s.classKey, pos: V.v3(...s.pos), facing: V.v3(...s.facing) })),
    enemy: SPEC.enemy.map(s => ({ classKey: s.classKey, pos: V.v3(...s.pos), facing: V.v3(...s.facing) })),
  });
  return ORDERS.map(o => sim.resolveTurn(st, JSON.parse(JSON.stringify(o)), {}).hash);
}

(async () => {
  const nodeHashes = runNode();

  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const page = await browser.newPage();
  for (const f of ["dmath.js", "rng.js", "data.js", "snapshot.js", "ai.js", "sim.js"])
    await page.addScriptTag({ content: fs.readFileSync(path + "/sim/" + f, "utf8") });
  const browserHashes = await page.evaluate(({ SPEC, ORDERS }) => {
    const { V } = FT.dmath;
    const st = FT.sim.createSkirmish("xclient-1", {
      player: SPEC.player.map(s => ({ classKey: s.classKey, pos: V.v3(...s.pos), facing: V.v3(...s.facing) })),
      enemy: SPEC.enemy.map(s => ({ classKey: s.classKey, pos: V.v3(...s.pos), facing: V.v3(...s.facing) })),
    });
    return ORDERS.map(o => FT.sim.resolveTurn(st, JSON.parse(JSON.stringify(o)), {}).hash);
  }, { SPEC, ORDERS });
  await browser.close();

  console.log("node    :", nodeHashes.join(" "));
  console.log("browser :", browserHashes.join(" "));
  const same = nodeHashes.every((h, i) => h === browserHashes[i]);
  console.log(same ? "\nMATCH - identical state on both clients from orders alone" : "\nDIVERGENCE");
  process.exit(same ? 0 : 1);
})();
