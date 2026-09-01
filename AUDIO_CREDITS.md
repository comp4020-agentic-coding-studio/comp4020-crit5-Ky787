# Binary Ninja audio credits

All runtime audio in this first-pass audition set is released under
[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/). Attribution is not
required, but original names and provenance are retained here so every sound remains replaceable.

## Music

| Project filename | Original filename | Pack / author | Source | Processing |
| --- | --- | --- | --- | --- |
| `public/audio/music/ambient-pulse.ogg` | `pulse.ogg` | Dark Sci-Fi Audio Pack / SRG774 | [OpenGameArt](https://opengameart.org/content/dark-sci-fi-audio-pack) | Loudness-normalised and re-encoded as Vorbis so its perceived level matches `airy.ogg`. |
| `public/audio/music/level02-firewall.ogg` | `transmission.ogg` | Dark Sci-Fi Audio Pack / SRG774 | [OpenGameArt](https://opengameart.org/content/dark-sci-fi-audio-pack) | Lowered 1.2 dB and re-encoded as Vorbis for Firewall's softer background bed. |
| `public/audio/music/ambient-airy.ogg` | `airy.ogg` | Dark Sci-Fi Audio Pack / SRG774 | [OpenGameArt](https://opengameart.org/content/dark-sci-fi-audio-pack) | Remuxed from the supplied OGG and renamed; audio content unchanged. |
| `public/audio/music/level04-watchdog.ogg` | `sector.ogg` | Dark Sci-Fi Audio Pack / SRG774 | [OpenGameArt](https://opengameart.org/content/dark-sci-fi-audio-pack) | Lowered 2 dB and re-encoded as Watchdog's normal-pressure bed. |
| `public/audio/music/level05-blackout.ogg` | `title.ogg` | Dark Sci-Fi Audio Pack / SRG774 | [OpenGameArt](https://opengameart.org/content/dark-sci-fi-audio-pack) | Extracted a distinct 88 s passage from 0:10, softened with a low-pass filter, faded, and loudness-normalised. |
| `public/audio/music/level06-relay.ogg` | `title.ogg` | Dark Sci-Fi Audio Pack / SRG774 | [OpenGameArt](https://opengameart.org/content/dark-sci-fi-audio-pack) | Extracted different musical material from 3:30 for 88 s, high-pass filtered, faded, and loudness-normalised. |
| `public/audio/music/level07-quarantine.ogg` | `airy.ogg` | Dark Sci-Fi Audio Pack / SRG774 | [OpenGameArt](https://opengameart.org/content/dark-sci-fi-audio-pack) | Slowed and pitched down 8%, low-pass filtered, lowered 1 dB, and re-encoded for a deeper shaft ambience. |
| `public/audio/music/level08-root.ogg` | `pulse.ogg` + `transmission.ogg` | Dark Sci-Fi Audio Pack / SRG774 | [OpenGameArt](https://opengameart.org/content/dark-sci-fi-audio-pack) | Mixed with Pulse dominant and Transmission filtered underneath, then loudness-normalised. |
| `public/audio/music/tension-urgent.ogg` | `urgent.ogg` | Dark Sci-Fi Audio Pack / SRG774 | [OpenGameArt](https://opengameart.org/content/dark-sci-fi-audio-pack) | Loudness-normalised and re-encoded as Vorbis so the tension layer remains audible. |
| `public/audio/music/level-complete.ogg` | `victory.ogg` | Dark Sci-Fi Audio Pack / SRG774 | [OpenGameArt](https://opengameart.org/content/dark-sci-fi-audio-pack) | Remuxed from the supplied OGG and renamed; audio content unchanged. |

## Sound effects

| Project filename | Original filename | Pack / author | Source | Processing |
| --- | --- | --- | --- | --- |
| `public/audio/sfx/grapple-fire.ogg` | `laserSmall_002.ogg` | Sci-Fi Sounds / Kenney | [Kenney](https://kenney.nl/assets/sci-fi-sounds) | Loudness-normalised and re-encoded as Vorbis; replaces the mechanical launcher with a short energy pulse. |
| `public/audio/sfx/grapple-attach.ogg` | `laserSmall_003.ogg` | Sci-Fi Sounds / Kenney | [Kenney](https://kenney.nl/assets/sci-fi-sounds) | Loudness-normalised and re-encoded as Vorbis; provides a distinct electronic connection chirp. |
| `public/audio/sfx/crumble-start.ogg` | `computerNoise_003.ogg` | Sci-Fi Sounds / Kenney | [Kenney](https://kenney.nl/assets/sci-fi-sounds) | Trimmed to 0.78 s, high-pass filtered, tremolo-processed, faded and loudness-normalised for digital corruption. |
| `public/audio/sfx/grapple-reel.ogg` | `computerNoise_002.ogg` | Sci-Fi Sounds / Kenney | [Kenney](https://kenney.nl/assets/sci-fi-sounds) | High-pass filtered and re-encoded as a quieter electronic reel loop. |
| `public/audio/sfx/landing.ogg` | `landing.ogg` | Platformer Sounds / yd | [OpenGameArt](https://opengameart.org/content/platformer-sounds-terminal-interaction-door-shots-bang-and-footsteps) | Re-encoded to Vorbis to repair malformed source duration metadata; capped at 1 s. |
| `public/audio/sfx/crumble-break.ogg` | `explosionCrunch_000.ogg` + `forceField_004.ogg` | Sci-Fi Sounds / Kenney | [Kenney](https://kenney.nl/assets/sci-fi-sounds) | Mixed with the force-field layer dominant, then loudness-normalised; reused pitch-shifted at runtime for death. |
| `public/audio/sfx/firewall-open.ogg` | `forceField_001.ogg` | Sci-Fi Sounds / Kenney | [Kenney](https://kenney.nl/assets/sci-fi-sounds) | Loudness-normalised and re-encoded as a short electric discharge. |
| `public/audio/sfx/notification.ogg` | `hover.ogg` | Dark Sci-Fi Audio Pack / SRG774 | [OpenGameArt](https://opengameart.org/content/dark-sci-fi-audio-pack) | Trimmed to 1.3 s, low-pass filtered, lowered 5 dB, and faded for a softer routine notification. |
| `public/audio/sfx/confirm.ogg` | `beep_message.ogg` | Platformer Sounds / yd | [OpenGameArt](https://opengameart.org/content/platformer-sounds-terminal-interaction-door-shots-bang-and-footsteps) | Trimmed to 0.85 s, faded, loudness-normalised, and encoded as Vorbis. Reused at different gains/rates for objectives, checkpoints and respawn. |
| `public/audio/sfx/scanner-loop.ogg` | `laserbeam.flac` | Laser Beam / frosty ham | [OpenGameArt](https://opengameart.org/content/laser-beam) | Converted FLAC to Vorbis; used as a low-volume, distance-mixed loop. |
| `public/audio/sfx/watchdog-warning.ogg` | `alarm.ogg` | Short Alarm / yd | [OpenGameArt](https://opengameart.org/content/short-alarm) | Remuxed from the supplied OGG and renamed; audio content unchanged. |

No audio from the optional Static pack is included. Seven source sounds from the Kenney fallback
pack are used across six runtime files; the rest of that pack is not shipped with the game.
