// Repelling Blast on/off switch. midi-qol onUse [postActiveEffects] on the invocation's "Toggle Push" activity.
// Flips the invocation's passive effect (flags.world.repellingToggle); Eldritch Blast's beam macro pushes only while
// that effect is enabled.
if (args[0]?.macroPass && args[0].macroPass !== "postActiveEffects") return;
const inv = actor.items.get(macroItem?.id ?? item?.id) ?? macroItem ?? item;
const toggle = inv?.effects?.find((e) => e.flags?.world?.repellingToggle);
if (!toggle) return ui.notifications.warn("Repelling Blast: the on/off effect is missing from the invocation.");
await toggle.update({ disabled: !toggle.disabled });
const on = toggle.disabled === false;
await ChatMessage.create({
  speaker: ChatMessage.getSpeaker({ actor }),
  content: `<p><strong>Repelling Blast</strong> push is now <strong>${on ? "ON" : "OFF"}</strong>${on ? " - Eldritch Blast hits push 10 ft." : " - Eldritch Blast won't push."}</p>`
});
