// Benign Transposition (Conjurer) - Swap Places. midi-qol onUse passes: preItemRoll, preTeleport.
// preItemRoll runs before the use is consumed, so a refused swap costs nothing.
// preTeleport performs the swap itself without auto-rotating the tokens, then cancels midi's own move.
const pass = args[0]?.macroPass;
if (pass !== "preItemRoll" && pass !== "preTeleport") return;
const act = workflow?.activity ?? macroActivity ?? rolledActivity;
if (act?.midiTeleport?.movers !== "swap") return;

const TITLE = "Benign Transposition";
const warn = (msg) => { ui.notifications.warn(`${TITLE}: ${msg}`); return false; };

const casterToken = token ?? MidiQOL.tokenForActor?.(actor);
if (!casterToken) return warn("your token isn't on this scene.");

// midi 14 target sets may hold TokenDocuments; always work with Tokens.
const asTokens = (list) => (list?.tokens ?? Array.from(list ?? [])).map((t) => t?.object ?? t).filter((t) => t?.document);
const others = (list) => asTokens(list).filter((t) => t !== casterToken && t.actor !== actor);

// ---------- preTeleport: swap without rotation ----------
if (pass === "preTeleport") {
  const target = others(args[0]?.options?.teleport?.tokens)[0] ?? others(workflow?.targets)[0];
  if (!target) return; // nothing to do; let midi handle/report it
  const posOf = (t) => {
    const s = t.document._source;
    return { x: s.x, y: s.y, elevation: s.elevation, level: s.level ?? undefined };
  };
  const from = posOf(casterToken);
  const to = posOf(target);
  const centreFor = (mover, dest) => ({
    x: dest.x + mover.w / 2, y: dest.y + mover.h / 2, elevation: dest.elevation,
    ...(dest.level ? { level: dest.level } : {})
  });
  const opts = { teleport: true, autoRotate: false };
  await Promise.all([
    MidiQOL.moveToken(casterToken.document, centreFor(casterToken, to), opts),
    MidiQOL.moveToken(target.document, centreFor(target, from), opts)
  ]);
  // Retire the card's Teleport button the way midi does after a move.
  const card = workflow?.chatCard;
  if (card?.isOwner && foundry.utils.getProperty(card, "system.midi")) {
    await card.update({ "system.midi.progress.teleported": true }).catch(() => {});
  }
  return false; // tokens already swapped: skip midi's (rotating) move
}

// ---------- preItemRoll: target checks ----------
const picked = others(workflow?.targets);
if (picked.length !== 1) return warn("target exactly one other creature to swap places with.");
const target = picked[0];

// Medium or smaller only
const SMALL_ENOUGH = ["tiny", "sm", "med"];
const size = target.actor?.system?.traits?.size;
if (!SMALL_ENOUGH.includes(size)) {
  const label = CONFIG.DND5E.actorSizes?.[size]?.label ?? size ?? "an unknown size";
  return warn(`${target.name} is ${label}; only a Medium or smaller creature can swap places with you.`);
}

// Within range
const maxRange = Number(act.teleport?.value ?? act.range?.value);
if (Number.isFinite(maxRange) && maxRange > 0 && MidiQOL.computeDistance) {
  const dist = MidiQOL.computeDistance(casterToken, target, { wallsBlock: false, includeCover: false });
  if (dist > maxRange + 0.01) return warn(`${target.name} is ${dist} ft away (range ${maxRange} ft).`);
}

// Willing: allies and player characters are treated as willing, hostiles never are, anyone else is asked.
const D = CONST.TOKEN_DISPOSITIONS;
const disp = target.document.disposition;
const sameSide = disp === casterToken.document.disposition && disp !== D.SECRET;
if (target.actor?.hasPlayerOwner || sameSide) return true;
if (disp === D.HOSTILE) return warn(`${target.name} is hostile and isn't willing to swap places.`);

const willing = await foundry.applications.api.DialogV2.confirm({
  window: { title: TITLE },
  content: `<p>Is <strong>${target.name}</strong> willing to swap places with ${casterToken.name}?</p>`,
  rejectClose: false
});
if (!willing) return warn(`${target.name} isn't willing; the swap is cancelled (no use spent).`);
return true;
