# Crit 5 — Binary Ninja

## What was the breakthrough that moved the work forward?

The main breakthrough was separating work for the game into stages where agents worked on each stage independantly. These agents would then create the outputs and share notes in the form of a handoff md where the next agent would then read. Overall I had 3 stages with the first tasked to generate the levels in C, the second was tasked to compile it and experiment to find the best compile switches and the third was tasked to use the generated assembly to generate the game itself. 

## What did this work change about who I want to be as a software developer?

Balancing the correct "dosage" of effort against tokens was tricky in this crit since I had to get agents to do something very complex. I initially choose to use highest thinking for the Opus model but in hindsight only the initial and other main prompts needed this level of thought as the other easy task could have been accomplished with sonnet. 
