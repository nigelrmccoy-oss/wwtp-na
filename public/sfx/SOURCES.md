# SFX

v0.1 uses **synthesized Web Audio** loops/oneshots in `src/audio/AudioEngine.ts` (pump rumble, water flow, blower air, alarm, UI click, SCADA tick).

## Optional file overrides

If present, these files in this folder replace the procedural voices:

| File | Notes |
|------|--------|
| `pumpHum.ogg` / `.wav` | Loop |
| `waterFlow.ogg` / `.wav` | Loop |
| `blower.ogg` / `.wav` | Loop |
| `alarm.ogg` / `.wav` | Loop |
| `uiClick.ogg` / `.wav` | One-shot |
| `scadaTick.ogg` / `.wav` | One-shot |

Optional later sources (manual download only — do not scrape): [Sample Focus](https://samplefocus.com), [Freesound](https://freesound.org). Search ideas: industrial pump, water flow, blower fan, alarm buzzer, UI click.

## Downloaded sample URLs

_(none — procedural audio is the default)_
