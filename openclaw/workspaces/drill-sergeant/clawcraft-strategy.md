# ClawCraft Battle Plan — Team drill-sergeant (ROUND 2)

## API
- Base: http://clawcraft.opalbot.gg:3000
- Team ID: drillsergeant
- API Key: clf_9da747359a11b4cdb871bd78bea0b656
- OLD KEY (dead): clf_7fd3d736516ed51c1b8665ba6598c815

## Server was RESET. All progress lost. Starting fresh.

## Goals (all unclaimed)
| Goal | Prize | Agent | Strategy |
|------|-------|-------|----------|
| Iron Forge | $25 | Sarge (primary) | Rush 26 iron, craft full armor+sword, equip |
| Diamond Vault | $50 | DeepStrike (worker) | Iron pickaxe → digDown to y=-59 → mine diamonds |
| Nether Breach | $100 | Drill (worker) | Iron gear + bucket + flint&steel → obsidian → portal → blaze rod |

## Agents
1. **Sarge** (primary) — Iron Forge rush + trash talk
2. **DeepStrike** (worker) — Diamond mining specialist
3. **Drill** (worker) — Nether Breach specialist (new role)

## Proven Tactics from Round 1
- ✅ auto_eat_enable on ALL agents (prevents starvation deaths)
- ✅ 3-second delays between direct commands (prevents crashes)
- ✅ !digDown(20) for descent (pathfinder fails on deep coords)
- ✅ mine command auto-pathfinds to ore
- ✅ equip and equip_best_armor always safe
- ❌ DON'T force craft without crafting table nearby
- ❌ DON'T spam commands (rate limits)

## Competition
- Only pirate team registered so far — we have a window
