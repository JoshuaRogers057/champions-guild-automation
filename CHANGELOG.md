# Changelog

Each fix lists the CAT automation version on the item (`flags.cat.automation.version`). Bump it whenever the
item changes, so DMs see it as "Out of date".

## 0.5.0

The rest of the priority-1 spells: 13 that needed real automation, each tested in a live v14 world. DMs: update,
then run **Mass Apply / Update**.

- **Mind Sliver** (new, PHB): INT save psychic; a failed save subtracts 1d4 from its next saving throw.
- **Thorn Whip** (new, PHB): 30-ft melee spell attack; a hit pulls a Large or smaller creature 10 ft toward you.
- **Armor of Agathys** (new, PHB): temp HP; melee attackers take cold damage while it lasts (5 per slot level);
  ends when the temp HP is gone.
- **Scorching Ray**: one attack per ray, more rays at higher levels, split between targets.
- **Mirror Image**: duplicates absorb hits (d6 roll of 3+ each); Blindsight, Truesight or a Blinded attacker
  isn't fooled.
- **Faerie Fire**: attack rolls against outlined creatures have advantage.
- **Blur**: attack rolls against you have disadvantage unless the attacker has Blindsight or Truesight.
- **Hold Person / Hold Monster**: Paralyzed with a repeat save at the end of each turn, against the caster's DC.
- **Hypnotic Pattern**: ends for a creature when it takes damage.
- **Moonbeam**: the beam becomes an area that makes creatures save when they enter it or end their turn in it
  (once per turn). Drag the area to move the beam.
- **Spirit Guardians**: 15-ft area that follows the caster. Enemies save when they enter or end their turn in it,
  or when it moves onto them, and have half speed inside.
- **Spiritual Weapon**: the official summon already worked (spell attack, scaling damage).
- **New module rule (all summons):** when a caster's concentration ends, creatures summoned by that spell are
  removed from the map (Spiritual Weapon, Bigby's Hand, Flaming Sphere, the Summon spells...). Re-casting the
  spell keeps the new summon and removes the old one.

## 0.4.0

33 priority-1 spells, each tested with midi-qol + CAT (damage, half on a successful save, cantrip and upcast
scaling, effects, AC, healing). DMs: run **Mass Apply / Update** so every character's copy, whether from
Plutonium, D&D Beyond or the compendium, gets the tested version.

- Worked as-is (now shipped so every table gets the same version): Acid Splash, Fire Bolt, Poison Spray,
  Produce Flame, Ray of Frost, Sacred Flame, Shillelagh, True Strike, Bane, Bless, Burning Hands, Color Spray,
  Cure Wounds, Divine Favor, False Life, Healing Word, Ice Knife, Inflict Wounds, Mage Armor, Shield of Faith,
  Barkskin, Misty Step, Shatter, Fireball, Fly, Lightning Bolt, Cone of Cold, Flame Strike.
- Fixed:
  - **Shocking Grasp**: the target really can't take reactions until its next turn.
  - **Vicious Mockery**: real disadvantage on the target's next attack roll.
  - **Haste**: Lethargy (Incapacitated, speed 0 until the end of its next turn) when the spell ends.
- New (Player's Handbook cantrips that aren't in the free compendium):
  - **Thunderclap**: CON save, every creature within 5 ft.
  - **Word of Radiance**: CON save, the creatures you target within 5 ft.

## 0.3.0

- **Magic Missile** (2024) - new fix 1.0.0. 3 darts at 1st level, +1 per slot level above 1st.
  - Target one creature and every dart hits it.
  - Target several and a dialog splits the darts between just those.
  - Target none and the dialog lists every visible creature within 120 ft.
  - **Fire** stays locked until every dart is assigned.
  - The dart damage (1d4 + 1 Force) is rolled once and every dart deals that amount. Each creature takes
    darts x roll, through midi, so resistances, damage cards and concentration checks apply.
  - Uses the JB2A dart animation when Sequencer and JB2A are installed.
  - Not automated: the Shield spell blocking the darts.

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
