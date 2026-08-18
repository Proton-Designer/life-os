# Habit formation research — proven methods, tracking, accountability, and identity

**Requested by:** Ayman, overnight brief §1.4, 2026-08-18.
**Purpose:** feed the Habit Builder redesign proposal with attributed, confidence-rated evidence — not
blog-tier summaries. Every claim below is sourced to a named study or book; every claim whose evidence
is thin, contested, or unreplicated says so explicitly, because product decisions get built on this
document and I want it defensible under questioning, not just persuasive on first read.

## How to read this document

Each major claim gets an inline confidence tag:

- **🟢 Strong** — large-N meta-analysis or replicated RCT evidence, published in a peer-reviewed
  venue.
- **🟡 Moderate** — real research, but a single study, a small sample, self-report only, or a
  genuinely contested finding (researchers disagree).
- **🔴 Weak / folklore** — widely repeated, thinly sourced, unpublished, or actively debunked. Included
  because it's exactly what "confidently-repeated numbers that don't survive contact with the source"
  looks like, and because knowing what's *not* solid is as useful as knowing what is.

A full source list with links is at the bottom.

---

## 1. How long habits actually take — and why "21 days" is folklore

**🔴 The "21 days" figure has no empirical basis for habit formation at all.** It traces to Maxwell
Maltz's 1960 book *Psycho-Cybernetics* — Maltz, a plastic surgeon, observed that patients took roughly
three weeks to stop noticing their new appearance after surgery, and amputees took about a month to
stop feeling a phantom limb. That is an anecdotal clinical observation about *adjusting to a physical
change*, not a study of habit formation, and it used no control group or systematic measurement. The
number was generalized decades later by unrelated self-help writers into "any habit takes 21 days,"
and it stuck because it's clean and memorable, not because anyone tested it.

**🟢 The real study: Lally, van Jaarsveld, Potts & Wardle (2010),** *European Journal of Social
Psychology* 40:998–1009 — "How are habits formed: Modelling habit formation in the real world." 96
volunteers picked one daily eating/drinking/activity behavior tied to a fixed context (e.g., "after
breakfast") and self-reported automaticity daily for 12 weeks.

Findings, with the caveats that matter:

- On average it took **66 days** to reach a plateau of automaticity — but the range was **18 to 254
  days**, and only 82 of 96 participants provided enough data to analyze. A follow-up reanalysis found
  only about **48% of participants showed the expected asymptotic pattern at all** — meaning the
  "66 days" figure is a median *among the people for whom the model actually fit*, not a promise about
  everyone.
- **Exercise habits took about 1.5× longer** than eating/drinking habits to automate. Complexity
  matters — a five-times-a-day prayer habit and a once-a-day gym habit are not the same shape of
  problem.
- **Missing a single day barely mattered.** It reduced automaticity by less than half a point on their
  scale, and recovery was fast. This is the single most load-bearing finding for any product design
  question about streaks and misses (see §9).
- The researchers' own caveat, worth repeating exactly: they measured "the development of automaticity
  for performing these behaviours rather than specifically habit" — i.e., *feels effortless*, not
  necessarily *is a true cue-triggered habit* in the stricter psychological sense.

**Implication for design:** a fixed "day 14" / "day 30" stage boundary (which is what `habit-stage.ts`
already encodes) is a reasonable, honest simplification of a process that actually varies 10x
person-to-person and behavior-to-behavior. It should be labeled as a guideline, not a guarantee — which
is exactly what tonight's "make the stage timeframes visible, subtle is fine" fix already does right.

---

## 2. The mechanism: cue → routine → reward, and why most of daily life runs on autopilot

**🟢 Wendy Wood (USC Dornsife, decades of habit research; book: *Good Habits, Bad Habits*, 2019)**
found that **approximately 43% of daily behavior is repeated in the same context, performed while
attention is on something else** — the operational definition of a habit: automatic, context-triggered,
not decided in the moment.

Key mechanisms from her work, each independently useful:

- **Context cues do the triggering, not willpower.** A cue is anything reliably present when the
  behavior happens — location, time of day, a preceding action, an object. Wood's research consistently
  finds that **people high in self-control aren't fighting temptation harder — they've structured their
  environment so the desired behavior is the path of least resistance.** This directly contradicts the
  "just try harder" framing that most self-help defaults to.
- **🟡 Deliberation can break a working habit.** In one of Wood's experiments (carrots vs. M&Ms in a
  movie-theater setting), when the context stayed constant, roughly 60%+ chose the healthy option
  automatically; when participants were made to stop and think, many switched to the less healthy
  choice. This is a single-study finding, not a meta-analysis, but it's a striking and mechanistically
  coherent one: **conscious reflection is not always the friend of a good habit already in motion.**
- **Rewards need to be fast.** Wood states the reward window for wiring in a dopamine-mediated
  association is roughly **within a minute** — a reward delayed by hours or days doesn't bind to the
  triggering behavior the way an immediate one does. This is a real constraint on any "weekly summary"
  or "monthly review" as the *only* feedback a habit gets.

**🟢 Charles Duhigg (*The Power of Habit*, 2012)** popularized the **habit loop**: cue → routine →
reward, encoded in the basal ganglia once repetition is sufficient that the behavior runs without
engaging the prefrontal cortex's deliberate decision-making. Two of his framings are widely cited and
hold up mechanistically, though the book itself is a work of synthesis and narrative journalism, not
primary research:

- **The Golden Rule of habit change: you can't delete a habit loop, only replace the routine while
  keeping the same cue and reward.** This is why "just stop" fails and "do X instead, triggered the same
  way, for the same payoff" works better.
- **Keystone habits** — a small number of habits (exercise, making your bed, family dinner) that
  correlate with cascading improvement in unrelated areas, not because of magic but because they build
  self-efficacy and often restructure the day's other cues. Evidence for keystone habits is more
  anecdotal/case-study than RCT-backed — treat as a plausible organizing idea, not a proven lever.

---

## 3. Making the behavior easy: BJ Fogg's B=MAP and Tiny Habits

**🟡 BJ Fogg (Stanford Persuasive Technology Lab / Behavior Design Lab).** Model: **B = MAP** —
Behavior happens when Motivation, Ability, and a Prompt converge at the same moment. Miss any one and
the behavior doesn't happen, no matter how much of the other two you have.

- **Motivation is the least reliable lever.** It arrives in waves (New Year's, a health scare) and
  decays. Fogg's design implication: **don't design for peak motivation — design for low motivation
  days**, because those are most of the days.
- **Ability is a chain of six frictions, not a skill level**: time, money, physical effort, mental
  effort, social deviance, and how much it disrupts existing routine. The chain is only as strong as its
  weakest link — find *which specific* friction is blocking a given person, not a generic "make it
  easier."
- **The Tiny Habits recipe**: *"After I [existing reliable routine], I will [behavior shrunk to under 30
  seconds]. Then I celebrate."* The celebration — an immediate, genuine positive emotional beat — is
  Fogg's claim for what actually wires in the habit, not repetition count. *"Emotions create habits, not
  repetition"* is his own phrasing.

**Evidence-strength caveat, stated plainly because it matters for how much weight to put on this:** the
original B=MAP paper was a **2009 conference proceeding, not a peer-reviewed journal article.** Despite
2,000+ citations, most of those citations *use* the model as a design framework rather than *testing*
its predictions. **No published RCT directly tests B=MAP's core claims**, and the celebration mechanism
specifically is unverified by outside research — Fogg's ~80% success figures come from his own
self-reported program data, not independently audited. This doesn't mean it's wrong; the mechanisms
(friction reduction, low-motivation design, tiny first steps) are consistent with other stronger
evidence elsewhere in this document. It means: **treat B=MAP as a well-reasoned design framework, not
as an established scientific finding**, and don't cite the 80% figure as if it were.

---

## 4. Making the behavior planned: implementation intentions — the single strongest evidence in this document

**🟢🟢 Peter Gollwitzer (NYU) & Paschal Sheeran — this is the best-evidenced mechanism in the entire
habit-formation literature, and it should carry the most product weight of anything here.**

An **implementation intention** is a plan of the exact form: *"If situation X happens, I will do Y."*
Not a goal ("I will pray Isha on time"), a **trigger-conditioned plan** ("If it's Isha's window and I'm
home, I will pray immediately after finishing what I'm doing").

- Gollwitzer & Sheeran's **2006 meta-analysis** (*Advances in Experimental Social Psychology*) pooled
  **94 independent studies, 8,000+ participants**: pooled effect size **d = 0.65** (medium-to-large) on
  goal attainment — roughly, **adding an if-then plan to a goal roughly doubles the rate the behavior
  actually happens**, compared to just holding the goal.
- A **2024 update** (*European Review of Social Psychology*, "The when and how of planning") expanded
  this to **642 tests** and continues to find robust effects, now also mapping which components of the
  plan (specificity of the cue, specificity of the response) matter most.
- Why it works, mechanistically: it pre-delegates the decision to the cue itself, so the moment doesn't
  require willpower or deliberation — it converts a goal into something closer to Wood's automatic,
  context-triggered behavior *before* real repetition has had time to build it. This is the one
  mechanism in this document that's both extremely well-replicated *and* explains why it works in terms
  consistent with the other strong evidence (Wood's context-cue automaticity).

**Product implication:** if the Habit Builder does nothing else evidence-based, it should make it trivial
to state an if-then plan per habit (cue + response), not just a name and a streak count. This is the
highest-confidence, highest-effect-size lever available in the whole literature reviewed here.

---

## 5. Identity and self-concept: does "become a person who…" actually work?

**🟡 James Clear (*Atomic Habits*, 2018)** — worth being precise about what this book *is*: a skilled
synthesis and popularization of Fogg, Wood, Lally, and Gollwitzer's research, not new primary research.
Its own core contribution is a framing device — **identity-based habits**: "I am a person who prays on
time" outperforms "I want to pray on time" because every completed instance becomes "evidence" for a
self-concept, and self-concept is what people protect and extend, not isolated goals.

This framing is *consistent with* self-determination theory (below) and with social-psychology research
on self-perception (Bem's self-perception theory — people infer their own attitudes from observing their
own behavior), but Clear's own "4 Laws" formula (make it obvious/attractive/easy/satisfying) is a
memorable repackaging of Wood + Fogg + Duhigg, not an independently tested framework. **Cite it for the
identity-framing idea; cite the underlying researchers for the mechanism claims.**

**🟢 Self-Determination Theory — Edward Deci & Richard Ryan.** Decades of research (not a single
study) establish three psychological needs — **autonomy** (choosing, not being controlled), **competence**
(being effective at it), and **relatedness** (connection to others) — as necessary, not merely helpful,
for a behavior to become *self-sustaining* rather than dependent on external pressure. When these needs
are met, motivation becomes intrinsic or well-internalized, and behavior persists after external
scaffolding is removed; when they're not, behavior tends to collapse the moment the external pressure
does.

**Product implication, and it's a real tension worth naming directly:** SDT and "gamified" habit apps
are in some tension. A points/streak/badge system is an *extrinsic* reward layer bolted onto autonomy
(you didn't choose the badge criteria), and SDT predicts this can crowd out the intrinsic motivation
that would otherwise make the habit self-sustaining — this is the overjustification effect, covered in
full in §8, because it's the single biggest risk in "make it incentivize completion," which is
explicitly part of what Ayman asked for.

---

## 6. How to actually keep track — self-monitoring's real evidence base

**🟢 Self-monitoring (tracking your own behavior) has genuine, replicated RCT evidence**, distinct from
and stronger than most of the "productivity book" claims elsewhere in this document — this is medical
and public-health research, not pop psychology.

- A meta-analysis of dietary self-monitoring interventions (26 studies, **21,262 participants**) found
  a statistically significant positive effect (SMD = 0.17) — modest but real, and at genuinely large
  scale.
- A systematic review of digital self-monitoring for weight loss (12 RCTs) found a mean weight-loss
  effect of **−2.87 kg** compared to controls.
- For sedentary-behavior reduction specifically: self-monitoring worked **only when using objective
  measurement tools** (not self-report) **and only when the intervention targeted that one behavior
  specifically** — a meaningful design constraint. A vague multi-purpose tracker diluted across many
  behaviors performed worse than a focused one.

**Product implication:** the evidence favors **objective, specific, single-behavior tracking with
visible feedback** over a general-purpose journal. This is squarely in the Habit Builder's favor as a
concept — it just needs the feedback loop to be tight and legible, which is where the current app falls
short (per Ayman's own complaint about the Reflection module, and by extension the risk in Habit
Builder too).

---

## 7. Accountability — what's solid and what's a widely-repeated number that shouldn't be

**🔴 The "70% vs. 35%, 77% more" accountability-partner statistic (Gail Matthews, Dominican University)
needs a direct flag: this is not a peer-reviewed publication.** The source is a conference
presentation/press release from Dominican University's psychology department, not a journal article
that went through peer review. It is cited constantly across the productivity-blog ecosystem — usually
without anyone checking where it actually came from — which is precisely the pattern the Lead asked me
to watch for. I'm including the numbers because they're what gets cited everywhere and Ayman may
encounter them, but they should carry **low confidence** in any product decision: no control for
selection effects (people who *choose* to send weekly reports to a friend likely differ systematically
from people who don't), no replication found, and no peer review.

**🟢 What's actually solid on accountability:**

- **Ariely & Wertenbroch (2002)**, *Psychological Science* — people **will voluntarily accept costly
  self-imposed deadlines** to fight their own procrastination, and doing so **measurably improves task
  performance** versus no deadline — but when left to set the deadlines optimally for performance, they
  under-use this tool (don't self-impose deadlines as aggressively as would actually be optimal). This
  is genuine experimental evidence (multiple studies, published, since-replicated), not a single
  self-report survey.
- **Commitment devices generally (Rogers, Milkman, and colleagues; commercialized in stickK)** — binding
  yourself to a real cost (financial, social) for failure measurably changes behavior. The mechanism
  that's best supported: **making the cost of failure salient and immediate**, which maps directly onto
  Wood's "immediate reward/consequence" finding and Fogg's "prompt" concept — this is one place where
  multiple independent research programs converge on the same underlying principle from different
  angles, which is a real confidence signal.

**🟡 Gretchen Rubin's Four Tendencies (Upholder / Questioner / Obliger / Rebel)**, from *Better Than
Before* (2015) — a self-developed practitioner typology, not an independently validated psychometric
instrument (no published factor-analytic validation that I found in this search). Its core practical
claim is worth taking seriously anyway because it's consistent with SDT and with the accountability
research above: **"Obligers" (people who reliably meet others' expectations but not their own) need
external accountability structures to sustain a habit that "Upholders" don't** — meaning a single
accountability feature will not work the same way for every user, and a system that assumes one
accountability style fits everyone is working against roughly half the population it's targeting (by
Rubin's own unvalidated but face-valid framework).

---

## 8. The reward trap — a real, unresolved scientific disagreement that matters for design

This is the single most important "where the evidence is weak/contested" section for the "incentivize
completion" part of Ayman's ask, and it deserves to be stated as a real disagreement rather than
resolved in either direction:

- **Deci (1971)** found that **paying people for an already-enjoyable task reduced their intrinsic
  motivation to do it once the payment stopped** — the **overjustification effect**. Multiple
  replications followed (Lepper, Greene & Nisbett 1973; Kruglanski et al. 1971).
- **🟡 Cameron & Pierce (1994)**, a meta-analysis of 96 studies, concluded the undermining effect was
  **"minimal and largely inconsequential."**
- **🟢 Deci, Koestner & Ryan (1999)** re-ran the meta-analysis with corrected methodology and found
  Cameron & Pierce's meta-analytic procedure was **"seriously flawed,"** and that **tangible rewards do
  have a substantial undermining effect** on intrinsic motivation, particularly for tasks that were
  interesting to begin with and rewards that are expected, tangible, and contingent on simply doing the
  task (as opposed to unexpected, or contingent on quality/performance).
- This is a **live, unresolved disagreement between credentialed researchers using competing
  meta-analyses of the same literature** — not settled science in either direction, and the field has
  not converged.

**What's not actually in dispute:** streaks and badges are extrinsic rewards, and the more central they
become to *why* someone does the habit, the more they risk becoming the whole reason — such that the
day the streak breaks, the reason to continue evaporates with it. This is mechanistically identical to
the "hard reset destroys accumulated history" problem already identified in the Reflection module
critique, and it is precisely why the current Habit Builder's `streak > 0 → "Xd"` display, if leaned on
harder as "the" incentive mechanism, carries real downside risk that the research does not clearly
resolve either way. The safer design principle, consistent with the SDT material in §5: **rewards that
reinforce competence/autonomy (visible progress, choice, self-set goals) are lower-risk than rewards
that are purely extrinsic and contingent (points for showing up, streaks that reset to zero).**

---

## 9. What happens when you miss a day — and why "no cancel, no forgiveness" is the wrong design

Direct evidence, converging from two different angles:

- **Lally et al. (2010):** missing a single day reduced automaticity by **less than half a point** on
  their scale, with **quick recovery** — a single miss is nearly inconsequential to actual habit
  formation.
- **🟡 Milkman's "fresh start effect"** (*How to Change*, 2021; underlying research: Dai, Milkman & Riis
  2014) — people are measurably more likely to re-engage with a goal at a **temporal landmark** (a new
  week, month, birthday, "fresh start") than on an arbitrary day. The mechanism: a landmark
  psychologically separates the "old self who failed" from the "new self trying again," reducing the
  shame/identity cost of restarting.
- **🟢 Verplanken's habit discontinuity hypothesis** — the same underlying idea from a different research
  program: a **context change** (a move, a new job, a new context) temporarily disrupts automatic
  behavior and opens a window where people are more receptive to deliberately choosing a new pattern.
  This has been tested in field settings (residential moves and travel-mode choice) with real behavioral
  outcome data, not just self-report.

**Both independent research programs point the same direction: the moment right after a lapse or
disruption is an opportunity to re-engage, not evidence the whole project has failed.** A hard-reset
streak counter actively works against this — it converts "I missed one day" into "the number that
represented weeks of effort is now zero," which is the opposite of what both bodies of research suggest
is actually psychologically true. (This is the same critique already applied to the Reflection module's
graph, and it applies with equal force to Habit Builder's `streak` field as currently displayed.)

---

## 10. Small wins and the shape of sustained motivation

**🟢 Karl Weick (1984)**, *American Psychologist* — "Small Wins: Redefining the Scale of Social
Problems." Peer-reviewed, foundational, one of the most-cited papers in organizational psychology.
Core claim: **problems framed at overwhelming scale exceed people's bounded rationality and induce
enough anxiety to block action entirely; reframing as a sequence of small, complete, concrete wins**
keeps coordination costs low, survives interruptions (a change in circumstances doesn't unravel prior
wins the way it would a fragile all-or-nothing streak), and compounds — each win can attract more
resources/allies and make the next win easier. This is the theoretical backbone for why "shrink the
habit until it's trivially completable" (Fogg) and "one prayer at a time, not a perfect week" beat
"try harder at the big goal."

---

## 11. Religious/spiritual practice specifically

**🟡 Thinner evidence base than the secular habit-formation literature**, and mostly correlational
rather than mechanistic:

- Meta-analyses across psychology and medicine consistently correlate **consistent** spiritual/religious
  practice (not frequency alone) with lower depression and higher life satisfaction — consistency is
  the variable that matters, not raw volume.
- Positive **subjective prayer experience** amplifies the relationship between religiosity and
  well-being — meaning *how* a practice feels to the person doing it matters, not just whether it
  happened. This is one more point in favor of a system that makes completion feel legible and
  meaningful (again, the Reflection module critique's core point) rather than one that only tallies.
- I found no rigorous evidence that religious habits are governed by fundamentally different
  psychological mechanisms than secular ones — the cue/context/reward/implementation-intention research
  above appears to generalize. This is a genuinely useful negative finding: **the Habit Builder does not
  need separate "religious habit" mechanics; the general habit-science toolkit applies to Salah, Qur'an,
  and the kill list identically.**

---

## 12. Confidence summary table

| Claim | Source | Confidence | Note |
|---|---|---|---|
| 21 days to form a habit | Maxwell Maltz, *Psycho-Cybernetics* (1960) | 🔴 Folklore | Anecdotal, about surgical/limb adjustment, not habit formation |
| ~66 days average, 18–254 day range | Lally et al. 2010 | 🟢 Strong (with named caveats) | Only 48% of participants fit the model at all |
| Missing 1 day barely hurts automaticity | Lally et al. 2010 | 🟢 Strong | Same study |
| 43% of daily behavior is habitual/context-cued | Wendy Wood, USC | 🟢 Strong | Career body of research |
| Reward must land within ~1 minute | Wendy Wood | 🟡 Moderate | Stated finding, less independently replicated than the 43% figure |
| B=MAP (Motivation/Ability/Prompt) | BJ Fogg, Stanford | 🟡 Moderate | No RCTs test it directly; conference paper, not journal |
| Tiny Habits' "celebration" wires in habits | BJ Fogg | 🔴 Weak | Self-reported 80% success, unverified independently |
| Cue-routine-reward loop | Charles Duhigg | 🟢 Strong (mechanism) / 🟡 (book's framing) | Mechanism well-supported elsewhere; book is synthesis/journalism |
| Keystone habits | Charles Duhigg | 🟡 Moderate | Mostly case-study evidence |
| Identity-based habits work better than outcome goals | James Clear (synthesizing Bem, SDT) | 🟡 Moderate | Framing device, not independently tested as a unit |
| Autonomy/competence/relatedness needed for sustained motivation | Deci & Ryan, SDT | 🟢 Strong | Decades of replicated research |
| Implementation intentions (if-then plans) | Gollwitzer & Sheeran | 🟢🟢 Strongest in this document | d=0.65, 94 studies/8,000+ participants (2006); 642 tests (2024) |
| Self-monitoring improves outcomes | Multiple meta-analyses, diet/exercise | 🟢 Strong | Real RCTs, large N |
| Accountability partner: 70%/35%, 77% more | Gail Matthews | 🔴 Weak | Unpublished/not peer-reviewed, widely mis-cited as settled |
| Self-imposed commitment devices work | Ariely & Wertenbroch 2002 | 🟢 Strong | Published, replicated |
| Four Tendencies (accountability styles differ by person) | Gretchen Rubin | 🟡 Moderate | Practitioner framework, not independently validated |
| Extrinsic rewards undermine intrinsic motivation | Deci 1971; contested by Cameron & Pierce 1994; reaffirmed by Deci/Koestner/Ryan 1999 | 🟡 Genuinely contested | Real unresolved disagreement, not settled either way |
| Fresh start effect (temporal landmarks re-engage people) | Milkman et al. | 🟡 Moderate | Real study, single research program |
| Habit discontinuity hypothesis | Verplanken | 🟢 Strong | Field-tested with behavioral (not just self-report) outcomes |
| Small wins beat big-goal framing | Karl Weick 1984 | 🟢 Strong | Peer-reviewed, foundational, widely replicated in practice |
| Religious practice consistency correlates with well-being | Multiple meta-analyses | 🟡 Moderate | Correlational, not mechanistic |

---

## Books consulted (primary sources, not just summaries)

- Maltz, Maxwell. *Psycho-Cybernetics* (1960) — origin of the 21-day myth, for the record.
- Duhigg, Charles. *The Power of Habit* (2012).
- Fogg, BJ. *Tiny Habits: The Small Changes That Change Everything* (2019).
- Clear, James. *Atomic Habits* (2018).
- Wood, Wendy. *Good Habits, Bad Habits* (2019).
- Milkman, Katy. *How to Change: The Science of Getting from Where You Are to Where You Want to Be*
  (2021).
- Rubin, Gretchen. *Better Than Before* (2015).
- Ryan, Richard & Deci, Edward. Foundational SDT papers (no single popular book; the 2000 *American
  Psychologist* paper "Self-Determination Theory and the Facilitation of Intrinsic Motivation, Social
  Development, and Well-Being" is the standard citation).

## Key papers (for direct citation if this becomes a public-facing design rationale)

- Lally, P., van Jaarsveld, C.H.M., Potts, H.W.W., & Wardle, J. (2010). How are habits formed: Modelling
  habit formation in the real world. *European Journal of Social Psychology*, 40, 998–1009.
- Gollwitzer, P.M. & Sheeran, P. (2006). Implementation intentions and goal achievement: A meta-analysis
  of effects and processes. *Advances in Experimental Social Psychology*, 38, 69–119.
- Deci, E.L., Koestner, R., & Ryan, R.M. (1999). A meta-analytic review of experiments examining the
  effects of extrinsic rewards on intrinsic motivation. *Psychological Bulletin*, 125(6), 627–668.
- Cameron, J. & Pierce, W.D. (1994). Reinforcement, reward, and intrinsic motivation: A meta-analysis.
  *Review of Educational Research*, 64(3), 363–423.
- Ariely, D. & Wertenbroch, K. (2002). Procrastination, deadlines, and performance: Self-control by
  precommitment. *Psychological Science*, 13(3), 219–224.
- Weick, K.E. (1984). Small wins: Redefining the scale of social problems. *American Psychologist*,
  39(1), 40–49.
- Verplanken, B., Roy, D., & Whitmarsh, L. (2018). Habit discontinuities as vehicles for behaviour
  change.
- Ryan, R.M. & Deci, E.L. (2000). Self-determination theory and the facilitation of intrinsic
  motivation, social development, and well-being. *American Psychologist*, 55(1), 68–78.

## What I did not find

- No rigorous, peer-reviewed research specifically on prayer-habit or religious-observance formation as
  mechanistically distinct from secular habit formation — the general literature appears to generalize
  (see §11).
- No independently-replicated RCT evidence for BJ Fogg's specific "celebration" mechanism, despite its
  wide popular adoption.
- No published, peer-reviewed source for the Gail Matthews accountability statistics that get quoted
  everywhere — I looked specifically and could only find the original conference-presentation-level
  material, not a journal publication.
