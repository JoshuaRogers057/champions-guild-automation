// Wither and Bloom (2024). midi-qol onUse passes: preSave (choose creatures), postActiveEffects (Bloom healing).
const pass = args[0]?.macroPass;
if (pass !== "preSave" && pass !== "postActiveEffects") return;
if (!workflow) return;

const TITLE = "Wither and Bloom";
const esc = (s) => (foundry.utils.escapeHTML ? foundry.utils.escapeHTML(String(s ?? "")) : String(s ?? ""));
const spellItem = rolledItem ?? macroItem ?? item;
const casterToken = token ?? MidiQOL.tokenForActor?.(actor);
const tokensOf = (set) => set?.tokens ?? Array.from(set ?? []).map((t) => t?.object ?? t).filter(Boolean);

// Unexpended hit dice, largest first: [{kind, item?, faces, value, spent}]
function hdPools(a) {
  if (!a) return [];
  if (a.type === "character") {
    return Object.values(a.classes ?? {})
      .filter((c) => (c.system.hd?.value ?? 0) > 0)
      .map((c) => ({ kind: "class", item: c, faces: parseInt(String(c.system.hd.denomination).replace(/\D/g, "")) || 0, value: c.system.hd.value, spent: c.system.hd.spent ?? 0 }))
      .filter((p) => p.faces > 0)
      .sort((x, y) => y.faces - x.faces);
  }
  const hd = a.system.attributes?.hd;
  const faces = Number(String(hd?.denomination ?? "").replace(/\D/g, ""));
  if (hd && (hd.value ?? 0) > 0 && faces > 0) return [{ kind: "npc", faces, value: hd.value, spent: hd.spent ?? 0 }];
  return [];
}
const hdLabel = (pools) => pools.length ? pools.map((p) => `${p.value}d${p.faces}`).join(" + ") : "none";

// ---------------- preSave: pick who withers and who blooms ----------------
if (pass === "preSave") {
  if (workflow.witherBloom) return;
  const area = tokensOf(workflow.targets);
  const castLevel = Number(workflow.castData?.castLevel ?? workflow.spellLevel ?? spellItem?.system?.level ?? 2) || 2;
  const maxHD = 1 + Math.max(0, castLevel - 2);
  const casterDisp = casterToken?.document?.disposition;
  const isAlly = (t) => t === casterToken || t.actor === actor || (casterDisp !== undefined && t.document.disposition === casterDisp);

  // Default Bloom: the most-wounded ally in the area with a hit die to spend.
  let defaultBloom = "none";
  let worst = 0;
  for (const t of area) {
    const hp = t.actor?.system?.attributes?.hp;
    const missing = hp ? (hp.effectiveMax ?? hp.max) - hp.value : 0;
    if (isAlly(t) && hdPools(t.actor).length && missing > worst) { worst = missing; defaultBloom = t.document.uuid; }
  }

  const rows = area.map((t, i) => {
    const pools = hdPools(t.actor);
    const uuid = t.document.uuid;
    return `<tr>
      <td style="text-align:center"><input type="checkbox" name="w${i}" ${isAlly(t) ? "" : "checked"}></td>
      <td><img src="${esc(t.document.texture?.src)}" width="28" height="28" style="vertical-align:middle;border:none"> ${esc(t.name)}</td>
      <td style="text-align:center"><input type="radio" name="bloom" value="${esc(uuid)}" ${pools.length ? "" : "disabled"} ${defaultBloom === uuid ? "checked" : ""}></td>
      <td style="text-align:center">${hdLabel(pools)}</td>
    </tr>`;
  }).join("");

  const content = `
    <p>Choose which creatures in the sphere make the Constitution save, and one creature that may spend Hit Point Dice to heal.</p>
    <table>
      <thead><tr><th>Wither</th><th>Creature</th><th>Bloom</th><th>Hit Dice left</th></tr></thead>
      <tbody>${rows}
        <tr><td></td><td><em>No one blooms</em></td><td style="text-align:center"><input type="radio" name="bloom" value="none" ${defaultBloom === "none" ? "checked" : ""}></td><td></td></tr>
      </tbody>
    </table>
    <div class="form-group"><label>Hit Point Dice to spend (max ${maxHD})</label>
      <input type="number" name="hd" value="${maxHD}" min="1" max="${maxHD}" step="1"></div>`;

  let data = null;
  if (area.length) {
    try {
      data = await foundry.applications.api.DialogV2.input({
        window: { title: TITLE },
        position: { width: 480 },
        content,
        ok: { label: "Cast" },
        rejectClose: false
      });
    } catch (err) { console.warn(`${TITLE} | dialog failed`, err); }
  }

  // Closed dialog -> defaults (non-allies wither, default bloom target).
  const keep = area.filter((t, i) => data ? !!data[`w${i}`] : !isAlly(t));
  const bloomUuid = data ? (data.bloom ?? "none") : defaultBloom;
  const hd = Math.clamp(parseInt(data?.hd ?? maxHD) || maxHD, 1, maxHD);
  workflow.witherBloom = { bloomUuid, hd, areaUuids: area.map((t) => t.document.uuid) };

  // Drop the excluded creatures from the save (midi re-reads user targets right after preSave).
  for (const t of area) if (!keep.includes(t) && t.isTargeted) t.setTarget(false, { releaseOthers: false });
  const SetClass = workflow.targets?.constructor ?? Set;
  workflow.targets = new SetClass(keep);
  workflow.hitTargets = new SetClass(keep);
  return;
}

// ---------------- postActiveEffects: Bloom ----------------
const wb = workflow.witherBloom;
if (!wb || wb.done || !wb.bloomUuid || wb.bloomUuid === "none") return;
wb.done = true;

const targetDoc = fromUuidSync(wb.bloomUuid);
const tActor = targetDoc?.actor;
if (!tActor) return;

const pools = hdPools(tActor);
if (!pools.length) {
  ui.notifications.info(`${TITLE}: ${targetDoc.name} has no Hit Point Dice left to spend.`);
  return;
}

let left = wb.hd;
const dice = [];
const itemUpdates = [];
const actorUpdates = {};
for (const p of pools) {
  const use = Math.min(left, p.value);
  if (use <= 0) continue;
  left -= use;
  dice.push(`${use}d${p.faces}`);
  if (p.kind === "class") itemUpdates.push({ _id: p.item.id, "system.hd.spent": p.spent + use });
  else actorUpdates["system.attributes.hd.spent"] = p.spent + use;
  if (left <= 0) break;
}
const spentCount = wb.hd - left;

// Spellcasting ability modifier used for this spell (e.g. INT for a wizard spell).
// dnd5e only adds @mod to an activity's roll data, not the item's, so resolve the ability directly.
const spellActivity = workflow.activity ?? rolledActivity ?? macroActivity;
const castAbility = spellActivity?.spellcastingAbility
  ?? spellItem?.system?.availableAbilities?.first?.()
  ?? actor.system.attributes?.spellcasting
  ?? "int";
const mod = Number(actor.system.abilities?.[castAbility]?.mod ?? 0) || 0;
const abilityLabel = CONFIG.DND5E.abilities?.[castAbility]?.abbreviation?.toUpperCase?.() ?? castAbility.toUpperCase();
const roll = await new Roll(`${dice.join(" + ")} ${mod < 0 ? "-" : "+"} ${Math.abs(mod)}`).evaluate();
const healing = Math.max(0, roll.total);

const hp = tActor.system.attributes.hp;
const cantHeal = tActor.system.traits?.di?.value?.has?.("healing");
const effMax = hp.effectiveMax ?? (hp.max + (hp.tempmax ?? 0));
const newHP = cantHeal ? hp.value : Math.min(effMax, hp.value + healing);
actorUpdates["system.attributes.hp.value"] = newHP;

await roll.toMessage({
  speaker: ChatMessage.getSpeaker({ actor }),
  flavor: `<strong>${TITLE} - Bloom</strong><br>${esc(targetDoc.name)} spends ${spentCount} Hit Point ${spentCount === 1 ? "Die" : "Dice"} (${mod >= 0 ? "+" : ""}${mod} ${abilityLabel} spellcasting modifier)` +
    (cantHeal ? `<br><em>${esc(targetDoc.name)} can't regain Hit Points.</em>` : `<br>Regains ${newHP - hp.value} HP (${hp.value} → ${newHP})`)
});

if (tActor.isOwner) {
  if (itemUpdates.length) await tActor.updateEmbeddedDocuments("Item", itemUpdates);
  await tActor.update(actorUpdates);
} else {
  const socket = MidiQOL.socket();
  if (itemUpdates.length) await socket.executeAsGM("updateItems", { actorUuid: tActor.uuid, updates: itemUpdates });
  await socket.executeAsGM("updateActor", { actorUuid: tActor.uuid, updates: actorUpdates });
}
