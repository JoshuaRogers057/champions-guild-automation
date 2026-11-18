// Guidance: show midi-qol's "choose effect" skill list in two columns (this spell only).
if (args[0]?.macroPass && args[0].macroPass !== "preItemRoll") return;
const styleId = "guidance-two-col-style";
if (!document.getElementById(styleId)) {
  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = `
.midi-qol-choose-effect.guidance-two-col .form-footer { display: grid !important; grid-template-columns: 1fr 1fr; gap: 4px; }
.midi-qol-choose-effect.guidance-two-col .form-footer button { grid-template-columns: 26px 1fr; min-height: 32px; }
.midi-qol-choose-effect.guidance-two-col .form-footer button img { width: 24px; height: 24px; }`;
  document.head.append(style);
}
const marker = `.Item.${item.id}.ActiveEffect.`;
const hookId = Hooks.on("renderDialogV2", (app, element) => {
  const root = element instanceof HTMLElement ? element : app.element;
  if (!root?.classList?.contains("midi-qol-choose-effect")) return;
  if (!root.querySelector(`.form-footer button[data-action*="${marker}"]`)) return;
  Hooks.off("renderDialogV2", hookId);
  root.classList.add("guidance-two-col");
  const width = 420;
  app.setPosition({ width, height: "auto", left: Math.max(0, (window.innerWidth - width) / 2) });
});
setTimeout(() => Hooks.off("renderDialogV2", hookId), 120000);
