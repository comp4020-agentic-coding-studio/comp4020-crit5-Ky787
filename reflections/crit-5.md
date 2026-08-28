# Crit 5 — Binary Ninja

## What was the breakthrough that moved the work forward?

Reading the handoff's own honesty. The delivery report classified all five
levels "READY FOR FRONTEND", and it would have been easy to take that at face
value and start on the renderer. But one line in it said the validator was
"intentionally not a rope-physics engine", and when I measured the geometry the
consequence was stark: consecutive route platforms sit 15–260 units apart while
being 112–240 units wide. The levels were validated as reachable and were, in
practice, a continuous walkway. A grappling platformer built on them would have
had nothing to grapple.

The breakthrough was refusing to choose between "respect the data" and "make a
game". The binary facts and the physical layout are different kinds of claim,
and the delivery said so itself — coordinates are a first-pass layout, mappings
are authoritative. So the coordinates became a tunable layer with a
deterministic transform, and the tests became the thing that holds the line:
every id, mapping, instruction and provenance record is asserted unchanged
through it.

The second half of that was building a bot that plays the game. Once the physics
existed I could search real scripted input for a plan that clears each hop, and
then let it play whole levels — dying, respawning, retrying. Every tuning
decision after that was measured rather than guessed.

## What did this work change about who I want to be as a software developer?

I want to be the developer who reads the caveat. The most valuable sentence in
the whole handoff was the one admitting what the validation *didn't* cover, and
acting on it was worth more than anything I could have added to the renderer.
Upstream work that tells you its own limits deserves to be taken seriously in
both directions: trust the part it stands behind, and go and check the part it
doesn't.

It also changed what I think verification is for. I spent longer on the bot than
on any visual feature, and it repaid that several times over — it found that the
jump was strong enough to make the grapple pointless, that landings on a block's
lip slid straight back off, and that the hook was grabbing the block under the
player's own feet. None of those were visible in a screenshot. I would rather
build the instrument than keep squinting at the output.
