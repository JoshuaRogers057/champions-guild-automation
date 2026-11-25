# Changelog

Each fix lists the CAT automation version on the item (`flags.cat.automation.version`). Bump it whenever the
item changes, so DMs see it as "Out of date".

## 0.16.0

The last feats: the priority-3 general feats and the Epic Boons. Every feat in the Player's Handbook is now
automated, verified as standard, or left to the sheet/table. DMs: update, then run **Mass Apply / Update**. Medium
Armor Master's switch, Boon of Fortitude's healing, Last Stand, Shadowy Form and Free Casting are module rules.

- New feats:
  - **Athlete** (Climb Speed = Speed), **Dual Wielder** (off-hand attacks with any one-handed melee weapon),
    **Skulker** (Blindsight 10 ft).
  - **Chef**: Bolstering Treat activity (PB treats per Long Rest, PB Temp HP each).
  - **Medium Armor Master**: +1 AC switches on automatically in Medium armor with DEX 16+.
  - **Poisoner**: your Poison damage ignores Resistance; Apply Poison uses a dose and the coated weapon's next
    damaging hit forces a CON save (2d8 Poison and Poisoned until the end of your next turn).
- New Epic Boons:
  - **Combat Prowess**: Peerless Aim offers +99 to a missed attack (a hit, not a critical), once per round.
  - **Energy Resistance**: Choose Resistances activity; Energy Redirection Reaction sends 2d12 + CON of a chosen
    type at a creature (DEX save).
  - **Fate**: +2d4 prompt on your own missed attack or failed save; Improve Fate activity for others' rolls.
    Recharges on Initiative or a rest.
  - **Fortitude**: HP max +40; healing adds your CON modifier once per turn.
  - **Irresistible Offense**: B/P/S damage ignores Resistance; a natural 20 adds your STR or DEX score.
  - **Recovery**: Last Stand (drop to 1 HP and heal half your max, once per Long Rest, automatic) and Recover
    Vitality (spend d10s from a pool of ten).
  - **Speed** (+30 ft; Escape Artist ends Grappled), **Spell Recall** (Free Casting), **Night Spirit**
    (Resistance only outside Bright Light; Merge with Shadows).

## 0.15.0

The priority-2 feats, and Lucky now asks before you roll. DMs: update, then run **Mass Apply / Update** on each
character. Lucky's saving-throw prompt, Interception and Protection are module rules, so they work as soon as the
module updates.

- Changed: **Lucky** (1.2.0). Before you roll a saving throw that doesn't already have Advantage, you're asked
  whether to spend a Luck Point for Advantage (real Advantage, decided before any die is rolled). The 0.14.0
  "reroll after a failed save" prompt is gone. Saves that already have Advantage (War Caster on Concentration,
  Magic Resistance against spells, effects) don't ask.
- New feats:
  - **Charger**: after a melee hit on your turn, if you moved 10+ ft this turn, pick +1d8 damage or a 10-ft push
    (once per turn).
  - **Crusher**: push 5 ft prompt on a Bludgeoning hit (once per turn); a Bludgeoning crit gives attacks against the
    target Advantage until your next turn.
  - **Slasher**: a Slashing hit cuts the target's Speed by 10 ft until your next turn (once per turn); a Slashing crit
    gives it Disadvantage on attacks.
  - **Piercer**: rerolls the lowest Piercing damage die if it's below average (once per turn); a Piercing crit rolls
    one extra die.
  - **Shield Master**: Shield Bash prompt (STR save, push 5 ft or Prone) once per turn; Interpose Shield means no
    damage on a successful DEX save while holding a Shield (automatic; mark your Reaction yourself).
  - **Grappler**: Advantage against creatures you grapple; Punch and Grab prompt after an Unarmed Strike hit.
  - **Tavern Brawler** and **Unarmed Fighting**: bigger Unarmed Strike damage (1d4 rerolling 1s / 1d6, 1d8 with no
    weapon or Shield), Tavern Brawler's push, Unarmed Fighting's Grapple Damage activity.
  - **Crossbow Expert**, **Spell Sniper** (midi-qol doubles spell attack range; the book adds 60 ft) and **Speedy**
    (+10 ft; melee attacks against you on your own turn have Disadvantage).
  - **Durable** (Advantage on Death Saves; Speedy Recovery), **Musician** (Heroic Inspiration to up to PB allies),
    **Inspiring Leader** (Temp HP = level + WIS/CHA modifier, up to six), **Telekinetic** (Telekinetic Shove).
  - **Elemental Adept**: pick the type once; your damage of that type ignores Resistance (book: spells only) and your
    spells' 1s on its dice count as 2s.
  - Fighting styles: **Blind Fighting**, **Thrown Weapon Fighting**, **Interception** and **Protection** (the last
    two ask the ally's player before the attack/damage).
- **Sharpshooter** 1.0.1: shares its "no Disadvantage with an enemy nearby" setting with Crossbow Expert and Spell
  Sniper so owning several of them works.

## 0.14.0

The first batch of feats: the 16 priority-1 feats from the 2024 Player's Handbook. DMs: update, then run
**Mass Apply / Update** on each character. Heavy Armor Master, Mage Slayer's Concentration Breaker and Alert's
Initiative Swap prompt are module rules, so they work as soon as the module updates.

- New feats:
  - **Alert**: Proficiency Bonus to Initiative. Once everyone on your side has rolled Initiative, you're asked
    whether to swap with a willing ally (neither Incapacitated); the Initiative Swap activity opens it again.
  - **Tough**: Hit Point maximum +2 per character level.
  - **Savage Attacker**: once per turn on a weapon hit, the weapon's damage is rolled twice and the higher counts.
  - **Healer**: Battle Medic (uses a Healer's Kit use and one of the target's Hit Point Dice; heals the die, 1s
    rerolled, + Proficiency Bonus) and Healing Rerolls on your spells' healing dice.
  - **Great Weapon Master**: +Proficiency Bonus damage on Heavy weapon hits on your turn; after a melee crit or
    dropping a creature to 0 HP you're offered the Hew Bonus Action attack.
  - **Sharpshooter**: ranged weapon attacks ignore Half/Three-Quarters Cover and get no Disadvantage at long range
    or with an enemy within 5 ft.
  - **War Caster**: Advantage on Concentration saves.
  - **Mage Slayer**: creatures you damage have Disadvantage on the Concentration save; Guarded Mind offers to turn a
    failed INT/WIS/CHA save into a success (once per Short or Long Rest).
  - **Heavy Armor Master**: in Heavy armor, Bludgeoning/Piercing/Slashing damage from an attack that hits you is
    reduced by your Proficiency Bonus.
  - **Defensive Duelist**: Parry Reaction when a melee attack hits you while you hold a Finesse weapon (+PB AC until
    the start of your next turn).
  - **Polearm Master**: Pole Strike Bonus Action attack (d4 + STR Bludgeoning).
  - **Sentinel**: Halt - after a melee hit on someone else's turn you're asked whether it was an Opportunity Attack;
    if so the target's Speed is 0 for the rest of the turn.
  - **Great Weapon Fighting**, **Dueling** and **Two-Weapon Fighting** fighting styles.
- Changed: **Lucky** (1.1.0) now asks whether to spend a Luck Point when you fail a saving throw (the save is
  rerolled and the higher roll counts, the same odds as Advantage).
- The module now uses socketlib (already installed with midi-qol) so a player's Alert swap can change an ally's
  Initiative.

## 0.13.0

The last Player's Handbook spells, built from the book text, plus fixes where earlier versions didn't match the book.
Every spell on the list is now automated or deliberately left to the table. DMs: update, then run
**Mass Apply / Update**.

- New:
  - **Cordon of Arrows**: 4 pieces of ammunition (+2 per slot level) guard 30 ft; each enemy entering or ending its
    turn there saves or takes 2d4 piercing, using up a piece; the area disappears when none are left.
  - **Crown of Madness**: Charmed with forced attacks; repeat save at the end of each turn.
  - **Aura of Purity**: poison resistance in a 30-ft aura (Advantage on the condition saves is the player's to
    claim).
  - **Circle of Power**: Advantage on saves against magic, and no damage on a successful half-damage save, in a
    30-ft aura.
  - **Fount of Moonlight**: radiant resistance, +2d6 radiant on melee hits, and the Reaction that blinds an attacker.
  - **Grasping Vine**: 4d8 bludgeoning and Grappled, Lash Again as a Bonus Action (drag the pull yourself).
  - **Jallarzi's Storm of Radiance**: Blinded and Deafened inside; radiant and thunder save on appearing, entering
    or ending a turn there.
  - **Swift Quiver**: two bow or crossbow attacks now and with Two More Shots each turn, no ammunition used.
  - **Yolande's Regal Presence**: enemies in the 10-ft emanation save or take psychic damage, fall Prone and are
    pushed 10 ft.
- Fixed to match the book:
  - **Hail of Thorns** and **Lightning Arrow**: now instantaneous, with no concentration. After a ranged weapon
    attack (a hit, for Hail of Thorns) you're asked whether to cast it and with which slot. Lightning Arrow's 4d8
    replaces the weapon's damage, or deals half on a miss.
  - **Blinding Smite**: lasts 1 minute without concentration.
  - **Banishing Smite**: the target now gets a Charisma save before it's banished.
  - **Aura of Vitality**: the repeat heal happens at the start of your turns, not as a Bonus Action.
  - **Hunger of Hadar**: upcasting adds to the cold damage only (the book has you pick one).
- Tracker: Primordial Ward removed (it isn't in the 2024 Player's Handbook); Fount of Moonlight added.

## 0.12.0

21 priority-3 spells, each tested in a live v14 world. DMs: update, then run **Mass Apply / Update**.

- **Areas**:
  - Gust of Wind: STR save or pushed 15 ft, again for a creature ending its turn in the line.
  - Sleet Storm: DEX save or Prone and lose Concentration on entering or starting a turn there.
  - Wall of Thorns: the slashing save on entering the wall or ending a turn in it.
  - Incendiary Cloud: the fire save on entering or ending a turn in the cloud.
  - Earthquake: Prone and lose Concentration when cast and for creatures ending their turn in the area.
  - Conjure Celestial: your allies in the pillar are healed, everyone else makes the searing save.
  - Aura of Life: a 30-ft aura that moves with you; necrotic resistance, and allies at 0 HP regain 1 HP.
- **Summons**: Giant Insect, Faithful Hound (it bites the nearest enemy within 5 ft at the start of your turn),
  Conjure Fey (its extra damage dice counted one slot level too many; fixed), Create Undead.
- **Blink**: the d6 is rolled at the end of each of your turns; 4-6 makes you Ethereal until your next turn.
- **Dispel Magic**: ends spell effects on the target up to the slot level and rolls the check for higher ones.
- **Compulsion**: repeat save at the end of each turn.
- **Power Word Kill**: a creature at 100 HP or fewer dies; otherwise 12d12 psychic.
- Compendium versions with notes for the parts the DM runs: Wind Wall, Globe of Invulnerability, Wall of Ice,
  Symbol, Tsunami, Prismatic Wall.
- **Conjure Elemental** 1.0.1: the spirit's own save damage counted one slot level too many.

## 0.11.0

The 29 priority-3 spells to verify, each cast in a live v14 world. DMs: update, then run **Mass Apply / Update**.

- Worked as-is (now shipped so every table gets the same version): Levitate, Mind Spike, See Invisibility,
  Spider Climb, Suggestion, Gaseous Form, Revivify, Freedom of Movement, Antilife Shell, True Seeing, Fire Storm,
  Mind Blank, Power Word Heal.
- Fixed:
  - **Charm Person / Charm Monster**: the charm now ends when the target takes damage.
  - **Dominate Beast / Person / Monster**: the target repeats the save each time it takes damage.
  - **Calm Emotions**: applied both effects at once; now you pick one (the indifference ends on damage).
  - **Glyph of Warding**: Explosive Rune always dealt Acid with fast-forwarded rolls; now pick the type.
  - **Freezing Sphere**: its damage had no type; it's Cold.
  - **Resilient Sphere**: the enclosed creature can't be damaged from outside.
  - **Contagion**: pick the ability; the repeat saves are rolled and counted (three successes end it, three failures
    make it last 7 days).
  - **Sunburst**: Blinded creatures repeat the save at the end of each turn.
  - **Maze**: the banished creature's token is hidden until the spell ends.
  - **Holy Aura**: a 30-ft aura that moves with you; allies inside get Advantage on saves and attackers have
    Disadvantage; a Fiend or Undead that hits one in melee makes the CON save or is Blinded.
  - **Arcane Vigor**: heals you (it rolled but healed no one) with the Hit Die size you pick, more dice when upcast.
  - **Heroes' Feast**: Consume Feast now raises the Hit Point maximum by 2d10 as well.
- New: **Power Word Fortify** (Player's Handbook): divide 120 temporary hit points between up to six creatures.

## 0.10.0

The 8 Player's Handbook Summon spells, with their spirits in a new compendium, **CGA: Summoned Creatures** (24
spirits, one per form). No D&D Beyond or Plutonium import needed. DMs: update, then run **Mass Apply / Update**.

- **Summon Beast, Fey, Undead, Aberration, Construct, Elemental, Celestial, Fiend**: pick the form when you cast. The
  spirit's AC, Hit Points and damage scale with the slot level; its attacks and save DCs use the caster's spell attack
  bonus and spell save DC. It's removed when concentration ends, and disappears when it drops to 0 Hit Points.
- Automated abilities:
  - Undead: Ghostly touch frightens; Putrid's Festering Aura poisons creatures starting their turn next to it, and
    its Rotting Claw paralyzes a Poisoned target.
  - Aberrant: Slaad regenerates 5 HP each turn and its Claw blocks healing; Mind Flayer's Whispering Aura hits
    creatures next to it at the start of its turn.
  - Construct: Metal's Heated Body burns melee attackers; Stone's Stony Lethargy halves the speed of enemies that
    start their turn within 10 ft and fail the save.
  - Fey Step: Fuming gives Advantage on the next attack, Mirthful charms (until damaged).
  - Fiend: Magic Resistance; the Demon's Death Throes explode when it drops to 0 HP or the spell ends.
  - Celestial: Healing Touch (once per day) and the Defender's Radiant Mace temporary HP activity.
- Left to the table: the number of attacks in a Multiattack (half the spell's level), Pack Tactics, teleports,
  Tricksy's darkness, Clay's reaction, and the Yugoloth's teleport.
- Players summon the spirit themselves only if they're allowed to create actors (Foundry's "Create New Actors"
  permission) or the GM has summoned that spirit once before in the world. This is how dnd5e's own summons work too.
- **New module rule**: after a module update, the GM's client removes the world's cached copies of our spirits that
  aren't on a map, so the next summon uses the updated version.
- Fire Shield's retaliation code now also sees effects that come from items (needed for Heated Body); Fire Shield
  itself is unchanged.

## 0.9.0

14 summon and Conjure spells, plus a concentration fix for spells released in 0.5.0 to 0.8.0. DMs: update, then run
**Mass Apply / Update** (27 earlier spells are marked out of date because of the fix).

- **Summons** (placed when you cast; removed when concentration ends): Find Familiar, Find Steed, Animate Dead,
  Animate Objects, Bigby's Hand, Mordenkainen's Sword, Summon Dragon.
- **Summons that hurt creatures near them** (the module rolls the save automatically, once per turn):
  - Flaming Sphere: a creature ending its turn within 5 ft, or that you roll the sphere next to.
  - Conjure Animals: an enemy that comes within 10 ft of the pack, ends its turn there, or that the pack moves near.
  - Guardian of Faith: an enemy moving within 10 ft or starting its turn there; it vanishes after 60 damage.
  - Conjure Elemental: an enemy entering its space or starting its turn within 5 ft is Restrained (8d8 of the
    element's type); it saves at the start of its turns, taking 4d8 on a failure.
- **Conjure Woodland Beings**: a 10-ft emanation that moves with you; enemies save when it reaches them or they end a
  turn in it.
- **Conjure Minor Elementals**: pick the type; your attacks that hit a creature within 15 ft deal +2d8 of it.
- **Polymorph**: the save and a "Polymorphed" marker that ends with your concentration; the DM drags the Beast onto the
  creature's sheet to transform it.
- **Concentration fix**: using a spell's later activity (Siphon Life, Call Another Bolt, Arc Lightning, Heal in the
  Aura, Flame Blade's attack) or an area's save started a new concentration, which ended the old one (and with it the
  spell's effects and summons). Those activities no longer touch concentration.
- **New module rules (no Mass Apply needed)**: effects a concentration spell puts on creatures later (from its area,
  repeat saves or summons) now end with that concentration; summons with damaging auras are handled as listed above.
- Not done yet: the Player's Handbook "Summon" spells (Beast, Fey, Undead, Aberration, Construct, Elemental,
  Celestial, Fiend) need stat blocks that aren't in the free compendium.

## 0.8.0

23 more priority-2 spells, each tested in a live v14 world. DMs: update, then run **Mass Apply / Update**.

- **Areas** (the placed template becomes an area that acts on creatures automatically, once per turn):
  - Cloud of Daggers (new), Grease, Evard's Black Tentacles, Cloudkill, Insect Plague, Blade Barrier, Wall of Fire:
    damage or a save when the area appears, when a creature enters it and when it ends its turn there.
  - Stinking Cloud: CON save at the start of each turn in the cloud; Poisoned until the end of that turn.
  - Hunger of Hadar (new): Blinded inside, cold at the start of a turn there, DEX save or acid at the end.
  - Spike Growth: 2d4 Piercing for every 5 ft a creature moves into or within the area, rolled when the token moves.
  - Entangle: the compendium version works (the escape check stays manual).
  - Drag an area to move it (Cloud of Daggers, Cloudkill).
- **Type choices** (fast-forwarded rolls always picked the first damage type, so each type is its own activity):
  Sorcerous Burst, Chromatic Orb (matching dice let the orb leap to another creature within 30 ft, once per slot
  level), Elemental Weapon (new; +1/+2/+3 and 1d4/2d4/3d4 by slot).
- **Your next ranged weapon attack**: Hail of Thorns (new; thorns burst around the target on a hit) and Lightning
  Arrow (new; 4d8 lightning instead of the weapon's damage, half on a miss, and a burst within 10 ft).
- **Bestow Curse**: pick the curse and ability; the attack curse gives Disadvantage only against you, the action curse
  asks for a WIS save each turn, and the resilience curse adds 1d8 necrotic to your attacks and spells against it.
- **Confusion**: no Reactions, a d10 behaviour roll at the start of each turn, and a repeat save at the end.
- **Blade Ward** (new): attackers subtract 1d4. **Aura of Vitality** (new): 2d6 heal now and as a Bonus Action
  each turn. **Crusader's Mantle** (new): you and allies within 30 ft add 1d4 radiant to weapon hits.
  **Steel Wind Strike** (new): a separate attack against each of up to five creatures, then teleport.
  **Counterspell**: the compendium version works.
- **Module fix (no Mass Apply needed)**: effects that an area gives while a creature stands in it (Spirit Guardians'
  half speed, Hunger of Hadar's blindness, Crusader's Mantle) now end when the creature leaves the area or the spell
  ends. Before, Spirit Guardians' half speed stayed on.

## 0.7.0

25 more priority-2 spells, each tested in a live v14 world. DMs: update, then run **Mass Apply / Update**.

- **Repeat saves** (rolled automatically at the end of the creature's turn, against the caster's DC):
  Blindness/Deafness (now you pick which), Ray of Enfeeblement (a successful save gives Disadvantage on its next
  attack), Slow (also no Reactions), Phantasmal Killer (Disadvantage on checks and attacks, psychic damage again on
  each failed save; the compendium copy never asked for a save), Synaptic Static (new, -1d6 to attacks, checks and
  concentration saves).
- **Tasha's Hideous Laughter**: repeat save at the end of each turn, and with Advantage each time it takes damage.
- **Smites** (also offered by the Paladin's Smite prompt): Shining Smite (attacks against the target have
  Advantage), and new Blinding Smite (Blinded, repeat CON save), Staggering Smite (WIS save or Stunned until the end
  of your next turn) and Banishing Smite (a target left at 50 HP or fewer is banished until the spell ends).
- **Banishment**: the banished creature's token is hidden until the spell ends.
- **Heroism**: temp HP equal to your spellcasting modifier at the start of each of the target's turns.
- **Fire Shield**: pick warm or chill; melee attackers within 5 ft take 2d8 Fire or Cold.
- **Repeatable spells** (a no-slot activity for later turns): Vampiric Touch (you heal half the damage),
  Call Lightning (Call Another Bolt), Witch Bolt (new; Arc Lightning as a Bonus Action), Heat Metal (Reheat; the
  hot object now gives Disadvantage).
- **Protection from Evil and Good**: Aberrations, Celestials, Elementals, Fey, Fiends and Undead have Disadvantage
  attacking the target.
- **Beacon of Hope**: healing on the targets is maximized.
- **Death Ward**: the first drop to 0 HP becomes 1 HP, and the spell ends.
- **Resistance**: pick the damage type; 1d4 less damage of it, once per turn.
- **Warding Bond**: whenever the target takes damage, the caster takes the same amount.
- **Arms of Hadar** (new): STR save necrotic within 10 ft; no Reactions on a failure.
- **Compelled Duel** (new): Disadvantage on attacks against anyone but the caster.
- **Fear**: the compendium version works; the save to end it (only when the creature is out of your sight) is the
  DM's to roll.
- **New module rules**: Resistance, Death Ward and Warding Bond are handled by the module when damage is applied, so
  they work with any attack or spell that midi-qol rolls.

## 0.6.0

26 priority-2 spells, each cast in a live v14 world. DMs: update, then run **Mass Apply / Update**.

- Worked as-is (now shipped so every table gets the same version): Starry Wisp, Dissonant Whispers, Longstrider,
  Ray of Sickness, Darkvision, Flame Blade, Magic Weapon, Protection from Poison, Mass Healing Word, Blight,
  Dimension Door, Ice Storm, Stoneskin, Chain Lightning, Circle of Death, Disintegrate, Heal.
- Fixed:
  - **Acid Arrow**: the extra 2d4 Acid was dealt right away; now it lands at the end of the target's next turn
    (and scales with the slot).
  - **Vitriolic Sphere**: creatures that fail the save now take the extra 5d4 Acid at the end of their next turn.
  - **Prayer of Healing**: adds your spellcasting modifier to the healing.
  - **Protection from Energy**: gave all five resistances at once; now you pick one damage type.
  - **Enhance Ability**: gave Advantage on all five abilities; now you pick one.
  - **Enlarge/Reduce**: applied both effects, which cancelled out. Now there are Enlarge and Reduce activities;
    willing targets skip the save, and the "(CON save)" versions are for unwilling ones.
- New (Player's Handbook spells that aren't in the free compendium):
  - **Conjure Barrage**: 60-ft cone, DEX save, 5d8 Force.
  - **Conjure Volley**: 40-ft-radius cylinder, DEX save, 8d8 Force.
  - **Destructive Wave**: creatures you target within 30 ft, CON save, 5d6 Thunder + 5d6 Radiant or Necrotic
    and Prone.

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
