// Pull on a hit (Thorn Whip: 10 ft). midi-qol onUse [postActiveEffects]; the activity's midiProperties.identifier says
// how far: "pull-10". Large or smaller creatures that were hit move toward the caster one square at a time, stopping
// when adjacent. No token spin, no animation (animated moves stall when the GM's tab is in the background).
if (args[0]?.macroPass !== "postActiveEffects") return;
const m = (workflow?.activity?.midiProperties?.identifier ?? "").match(/^pull-(\d+)$/);
if (!m) return;
const feet = Number(m[1]);
const caster = token ?? MidiQOL.tokenForActor?.(actor);
if (!caster || !MidiQOL.moveToken) return;
const asTokens = (list) => (list?.tokens ?? Array.from(list ?? [])).map((t) => t?.object ?? t).filter((t) => t?.document);

let hits = asTokens(workflow.hitTargets);
let checkHits = "all";
try { checkHits = game.settings.get("midi-qol", "ConfigSettings")?.autoCheckHit ?? "all"; } catch (err) { /* keep default */ }
if (!hits.length && checkHits === "none" && workflow.attackRoll && !workflow.isFumble) {
  const total = Number(workflow.attackRoll.total ?? 0);
  hits = asTokens(workflow.targets).filter((t) => t.actor && (workflow.isCritical || total >= Number(t.actor.system?.attributes?.ac?.value ?? 10)));
}

const gs = canvas.grid.size;
const steps = Math.floor(feet / (canvas.scene.grid.distance || 5));
const box = (t, x = t.document.x, y = t.document.y) => ({ cx: x + t.w / 2, cy: y + t.h / 2, w: t.w, h: t.h });
// Empty squares between two token boxes (0 = touching).
const gap = (a, b) => Math.max(
  Math.max(0, Math.abs(a.cx - b.cx) - (a.w + b.w) / 2),
  Math.max(0, Math.abs(a.cy - b.cy) - (a.h + b.h) / 2)) / gs;

for (const t of hits) {
  if (t === caster || !["tiny", "sm", "med", "lg"].includes(t.actor?.system?.traits?.size)) continue;
  const c = box(caster);
  let x = t.document.x, y = t.document.y;
  for (let i = 0; i < steps; i++) {
    const b = box(t, x, y);
    if (gap(b, c) < 1) break;
    const dx = c.cx - b.cx, dy = c.cy - b.cy;
    x += Math.abs(dx) > gs / 2 ? Math.sign(dx) * gs : 0;
    y += Math.abs(dy) > gs / 2 ? Math.sign(dy) * gs : 0;
  }
  if (x === t.document.x && y === t.document.y) continue;
  try { await MidiQOL.moveToken(t.document, { x: x + t.w / 2, y: y + t.h / 2 }, { teleport: true, autoRotate: false }); }
  catch (err) { console.warn(`${workflow.item?.name} | pull failed`, err); }
}
