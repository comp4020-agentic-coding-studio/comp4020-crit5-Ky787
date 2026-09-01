# Process overview

## What I built

**Binary Ninja** — a browser grappling platformer whose levels are real compiled x86 Intel assembly obfuscated with O-LLVM. The binaries are compiled with clang and then traced with unicorn (python emulator) to get the assembly from main that was actually executed. The python script then knows the other blocks are fake O-LLVM inserted blocks and marks them as such. Finally these blocks are assembled by another python script to produce a 2d platformer. The aim of the main is to trace through main without falling down or getting hit by the firewalls or other obstacles while also avoiding fake O-LLVM blocks.

## The moments that mattered

### 1. Tested all gameplay and decided on new O-LLVM obfuscation and new levels which were then integrated into the game

After some testing with the original 5 levels I played through, I got some friends to test levels and provide feedback. Most notable was the levels themselves were lacking in form of interesting environment placements of code. I got my separate agent to work through generating new C programs which I then performed experiments on to find which combination of O-LLVM would produce the best code. After settling on new C binaries and O-LLVM switches in the form of stricter instruction substitution I eventually arrived at the current 8 levels which claude populated and implemented.

- [`c15d983`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Ky787/commit/c15d983) — added the fixed-step physics, grappling, hazards and shared level runtime.
- [`080983a`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Ky787/commit/080983a) — built the renderer, HUD, inspector and mission flow around the code data.
- [`e30f1c9`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Ky787/commit/e30f1c9) — added physics-based route checks and real-browser gameplay checks.
- [`3c9c809`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Ky787/commit/3c9c809) — integrated the final eight-level v2 dataset into the production game.

### 2. I played the game and suggested gameplay adjustments

I did various playthroughs and after getting real life experience playing the game where I asked claude to edit checkpoint, sweeper and code block changes. I suggested changing hikari code blocks to be closer to the real code blocks to blend in better and after various playthroughs I was satisfied, especially so when my friends testing the game found it to be an easier experience. This also included adding sound to the game which I got the agent to explore and choose sounds which I thought were pleasing to hear.

- [`d3ab811`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Ky787/commit/d3ab811) — broke up Sweep's long hold and made missed grapple shots behave naturally.
- [`8b16bc3`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Ky787/commit/8b16bc3) — strengthened the watchdog after playtesting showed it was not a meaningful threat.
- [`cc0315a`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Ky787/commit/cc0315a) — stabilised the vertical camera and tuned traversal.
- [`0bd9f10`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Ky787/commit/0bd9f10) — made fake platforms visually match regular platforms and aligned their grapple bounds.
- [`e7ca178`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Ky787/commit/e7ca178) — added the first audio pass and aligned Hikari collision bounds.
- [`317b8ad`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Ky787/commit/317b8ad) — synchronised the objective charge audio and reduced scanner difficulty.
- [`9a910c2`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-Ky787/commit/9a910c2) — made checkpoint regions much easier to identify among moving sweepers.
