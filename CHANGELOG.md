# Changelog

Each fix lists the CAT automation version on the item (`flags.cat.automation.version`). Bump it whenever the
item changes, so DMs see it as "Out of date".

## 0.2.1

- **Hunter's Mark** and **Hex** - fix 1.0.1. The bonus die was added twice when a character owns the spell twice
  (for example a Vengeance paladin's oath spell plus the class-list copy). Now it's added once per damage roll no
  matter how many copies there are. DMs: run **Mass Apply / Update** on characters with either spell.
  (The extra icon on the marked creature is dnd5e's "Marked" condition, which the spell applies along with the
  mark. It isn't a second Hunter's Mark.)

## 0.2.0

New fixes (all 1.0.0). DMs: after updating, run **Mass Apply / Update** on each character.

- **Paladin's Smite** (2024) - after a hit with a melee weapon or an Unarmed Strike, the paladin is asked whether to
  smite. The prompt lists the free Divine Smite (once per Long Rest) and every smite spell they have prepared, each
  with the spell-slot levels they have left. The smite goes to the creature they hit. Critical hits double its dice.
  Divine Smite's Fiend/Undead bonus is picked automatically. The prompt appears once per turn in combat, and not
  when the target is already at 0 HP.
- **Divine Smite**, **Searing Smite**, **Thunderous Smite**, **Wrathful Smite** (2024) - work from the smite prompt or
  cast directly. Searing: burn until a CON save ends it. Thunderous: on a failed STR save, push 10 ft and Prone.
  Wrathful: on a failed WIS save, Frightened with a repeat save at the end of each turn.
- **Hunter's Mark** (2024) - +1d6 Force on every attack roll that hits the marked creature. **Move Mark** (Bonus
  Action, no slot) moves the mark to a new creature after the target drops to 0 HP. You keep concentrating and the old
  mark is removed. It asks before moving off a creature that's still up.
- **Hex** (2024) - +1d6 Necrotic on every attack roll that hits the cursed creature (each Eldritch Blast beam counts).
  **Curse New Creature** moves the curse the same way as Move Mark.
- **Repelling Blast** (2024 invocation) - Eldritch Blast hits push Large or smaller creatures 10 ft. The **Toggle
  Push** activity turns it off and on. Also matches the Plutonium-imported "Eldritch Invocations: Repelling Blast".
- **Guidance** (2024) - pick the skill from a two-column list; +1d4 to that skill while concentrating.
- **Wither and Bloom** (2024) - choose who makes the save and which creature spends Hit Point Dice to heal.
- **Benign Transposition** (2024 Conjurer) - Swap Places checks the target is a willing Medium-or-smaller creature in
  range before a use is spent, and swaps the tokens without spinning them.
- **Lucky** (2024 feat) - Advantage on your next d20 Test, or Disadvantage on an attack against you, without using
  your Reaction.

## 0.1.0

- **Eldritch Blast** (2024) - fix 1.0.0. One attack roll per beam (2/3/4 beams at levels 5/11/17), with a dialog
  to split beams between targets. Agonizing Blast adds the spellcasting modifier only if the caster has the
  invocation. Repelling Blast pushes a Large or smaller creature 10 ft on a hit, with no token spin.
