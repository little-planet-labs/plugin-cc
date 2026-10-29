---
name: quality-bar
description: The quality bar Little Planet Factory agents hold work to so defects are prevented on the first pass rather than found by review — which work counts as foundational, pre-mortems that turn invariants into named tests, the rule that compatibility code exists only for formats that verifiably shipped, per-unit and repair-diff review, treating claims and verification output skeptically, and the default rule that agents don't write user-facing copy beyond inventoried labels. Per-role responsibilities for the overseer, manager, worker, researcher, inspector, and signoff.
user-invocable: false
---

# Quality bar

The goal is no bugs on the first pass. Inspection should confirm quality, not discover the defects. Most rules here apply in proportion to risk: foundational work gets the full bar, and everything else gets a lighter one. Two rules apply to all work: repair review and treating claims skeptically.

## Foundational work

A unit is **foundational** when other code builds on it, or when a defect in it corrupts data or spreads silently:

- Persistence, data models, schemas, and migrations.
- Sync, caching, and matching or merging logic.
- Shared interfaces between units: types, APIs, and contracts that several callers use.
- Auth, permissions, security, and money.
- Concurrency primitives, state machines, and anything with retries or partial failure.

When unsure, treat it as foundational and say so in the plan. Calling something "just polish", "just perf", or "just a refactor" doesn't lower its tier. Classify by what the code touches, not by why it's being changed.

## Pre-mortem: invariants become named tests (foundational)

Before dispatching a foundational unit, the lead writes its pre-mortem in the brief:

- **Invariants.** Plain sentences stating what must always hold. For example: "a failed upload never deletes the previous file", or "a user can only read rows in their own tenant".
- **Failure modes.** Specific ways this change could go wrong: partial failure, retries, empty and boundary inputs, concurrent writers, stale caches, time zones and DST, a removed default that existing data relies on.
- **A named test for each.** Every invariant and failure mode maps to a required test, named after what it asserts. The worker writes those tests, and its report maps each one to its test and result.

A foundational unit with an empty pre-mortem is either trivial or under-thought, so say which. When a change makes code ignore or override something, the pre-mortem lists everything that writes that thing. When a change removes a default, it says what happens to existing data that relied on it — and existing data counts only when the format that wrote it shipped, per Compatibility code below.

## Compatibility code is for formats that shipped

A migration, fallback, legacy branch, deprecation path, or version guard for a previous format — state files, schemas, payloads, config, CLI flags — is never written by default, and never requested in a brief by default. "Don't break existing users" is a fact to verify, not a default. Compatibility code exists only when an explicit instruction asked for it — the user in the session, or the project's `CLAUDE.md` naming the format — and only for a format that actually shipped.

- **Verify shipped first, before writing or requesting any of it.** Check git history on the default branch for when the format last changed, and the published package or deployed version for whether a release carries the old shape. When that takes more than a quick look, send it to the researcher. A format that never left a working tree, a feature branch, or this session — written by dev builds, test fixtures, local experiments, or an earlier unit in the same run — has not shipped, and there is nothing to be compatible with. When you can't tell (no history reachable, a private deploy), ask the user; don't write the compat path while unsure.
- **When it hasn't shipped, change the format in place.** Move every consumer to the new shape, regenerate or rewrite what the old shape wrote — including data written earlier in this run — and delete the old shape's code, tests, fixtures, and docs. The old format doesn't get a reader, a writer, a migration, or a trust rule.
- **When an explicit instruction asks for compatibility anyway,** still run the shipped check and report what it found before writing the path: a format that never shipped protects nobody, and the asker may not know it was never out.

## Tests that prove the property

- Assert the property itself, not something next to it. Checking that a function was called isn't the same as checking what it wrote.
- Fixtures must differ in the dimension the code branches on. Otherwise both branches pass for the same reason.
- A fake or mock must be able to express the transition the feature is about. If it can't, every test of that feature is decorative. A fake that's stricter than reality is also a defect.
- Write the expected result first. When a test fails, trace the failure. Never change the expectation to match the code.
- When a rule changes, delete or rewrite the tests that encoded the old rule rather than renaming them.
- Flaky or timing-dependent tests are defects. Fix them before anyone gets used to re-running them.
- If something can't be tested, say so. Stating what isn't covered beats inventing coverage.

## Verification output is evidence only when it's real

Treat verification commands with the same suspicion as the code:

- **Zero tests is no verdict.** `Executed 0 tests` next to a success line, a filter that matched nothing, or a test file that never compiled all look exactly like a pass. When tests were added, the executed count must go up.
- **Quote the command and the result lines.** "Tests pass" with no command and output is unverified.
- **Check the checks.** A grep that can never match, a command that doesn't exist on this OS (macOS has no `timeout`), and a pipe that hides the exit status all produce silent false passes.
- **Warnings stay at baseline.** New compiler or lint warnings count as part of the change.
- **Targeted runs aren't a release gate.** Before anything ships to users or testers, the full suite for the affected packages or targets runs, and any failure blocks.

## Claims are hypotheses until checked

Relaying a claim is making it. The lead doesn't pass on anything it hasn't verified:

- A worker's "I didn't touch X" or "I restored Y" gets checked against the diff or the filesystem.
- A reviewer's root-cause or coverage claim gets traced before it's routed as fact.
- A report that sounds complete is checked against the files it lists.
- Anything written into architecture docs or the knowledge vault is measured first.

Workers and managers may dispute a finding. A well-argued disagreement backed by measurements on both sides is worth more than compliance. A fix prescribed in a brief or a finding is a hypothesis. When the stated rule and the example disagree, the rule wins.

## Review

- **Per-unit review before integration (foundational).** Each foundational unit's diff goes to the inspector on its own before it's integrated with other units, in addition to the review of the combined change. Integrate it as soon as it passes.
- **Two rounds for foundational work.** At least two inspection rounds, with a verification round after any repair to persistence, sync, or matching logic. Other work gets the normal inspection heuristic: one round when it's called for.
- **Every repair gets reviewed (all work).** Most regressions come from repairs. Every repair diff goes back through inspection. The one exception is a repair that's exactly the fix the inspector prescribed plus a test that fails without it; there, the test run is the review.
- **Route findings with their reasons.** A finding goes back to its owner with the invariant it violates and the test that should pin it, never as "fix line 40". A repair worker gets enough context to avoid breaking a neighboring unit: the finding, the invariant, the pinning test, and the other units' files it must stay compatible with.
- **Three review rounds, then the overseer decides.** A round is one inspection of a unit, counting the first. If a unit still has blocking findings after its third round, stop routing repairs; a fourth pass of the same brief rarely fixes what three didn't. Kick it up to the overseer with the finding history: each round's findings, the fix attempted, and what came back. A manager reports this to the overseer instead of starting a fourth round. The overseer decides what changes before work resumes, for example:
  - rewrite the brief when it lacks context or states the wrong invariant,
  - coordinate units when the finding lives in the seam between them,
  - hand the unit to a fresh agent with the full history,
  - split the unit, or change the approach,
  - have the inspector re-verify a finding that looks wrong,
  - ask the user, when the way forward changes scope or is theirs to decide.

  The revised plan gets a fresh three rounds. Signoff's gap → fix → re-signoff loop follows the same limit. So does the research send-back loop, counted per research question: after three rounds, a manager escalates to the overseer, and the overseer asks the user.
- **Learn from each report.** When a finding matches a rule here, the rule wasn't applied or the check wasn't real. Say which in your report.

## User-facing copy

By default, agents don't write product prose. Product prose means sentences a user of the product reads: descriptions, help text, error and empty-state messages, onboarding, notifications, emails, and marketing.

- **Short labels are fine**: button text, field labels, menu items, column headers, and short titles.
- **Where a sentence is needed** for the feature to work, write the plainest functional placeholder and flag it for replacement.
- **Inventory every new or changed user-facing string** in the final report, verbatim, whether it's a label or a placeholder:

  | Location | String | Kind | Where it appears |
  |---|---|---|---|

This is on unless the project's `CLAUDE.md` says agents may write copy, or the user asks for copy in the session. Either one turns it off for the work it covers. Documentation and prose the user asked for as the task itself aren't product copy.

## Responsibilities by role

### Overseer

- Classify each unit as foundational or not during planning, and state the classification in your plan.
- Write the pre-mortem for foundational units yourself, and put it in the brief with its named-test mapping. When several units share an interface, pin its exact signatures in the briefs before dispatch.
- Send foundational units to per-unit inspection, and run the rounds and repair reviews above.
- When a unit changes a shared format — schema, state file, payload, config, CLI flag — pin the new shape in the brief and say explicitly whether the old format needs compatibility, after the shipped check. Default to no, and never promise old behavior for something that hasn't shipped. A mid-session format change re-briefs every unit that touches the format the same way.
- Verify claims before relaying them to the user or into briefs.
- Send unverified research findings and Unknowns back to the researcher, for up to three rounds per question, unless you've checked that verification is impossible. Grant what you can, such as scope, access, or permission to run a test, and hand up what only the user can grant.
- Include the copy inventory in your final report.

### Manager

- Apply the bar to your sub-task: classify units, write pre-mortems for foundational units that the overseer's brief didn't cover, and run per-unit and repair reviews.
- Pin changed formats in worker briefs the same way: the new shape, and an explicit compatibility answer after the shipped check. Default to no.
- Verify workers' claims before consolidating them into your report.
- Send unverified research findings and Unknowns back to the researcher, for up to three rounds per question, unless you've checked that verification is impossible. Grant what you can, such as scope, access, or permission to run a test, and hand up what only the user can grant.

### Worker

- Write every named test in your brief, and report each one against its invariant with the command and result lines.
- Never add compatibility code for an older format — migration, fallback, legacy branch, version guard — unless the brief explicitly asks for it. Data and code in an old format from earlier in the run, including your own earlier output, move to the new format. If you believe compatibility is genuinely needed, report it as a question instead of writing it.
- Run new tests green before relying on them, and confirm the executed count went up.
- Dispute a brief or a finding with evidence when you think it's wrong. Don't comply silently.
- List every user-facing string you added or changed, and flag placeholders.

### Researcher

- Verify first. Label a claim confirmed, with its source, or, as a last resort, inferred.
- An inferred claim says what you tried, why it can't be verified from where you sit, and what would settle it. Effort, time, or "it seems obvious" isn't a reason.
- A root-cause link you haven't traced is inferred too, with the same three fields.
- When later evidence contradicts an earlier finding, retract it explicitly.

### Signoff

- Check the copy inventory against the diff. Every new or changed user-facing string must be listed verbatim, with placeholders flagged. A missing entry is a gap.
- Treat product prose written against the default rule, and pre-mortem tests that were never written, as loose ends.
- Treat compatibility code nobody asked for, or that protects a format that never shipped, as unrequested scope.
- Mark a requirement Done only on evidence you checked yourself, not on a unit's report.

### Inspector

- For foundational units, check that every pre-mortem item has a test that asserts the property, not something next to it. A missing or decorative test is a blocking finding.
- Before passing any compatibility code — migration, fallback, legacy branch, version guard — ask who it protects, and verify the answer: git history on the default branch, the published or deployed version. Compat code nobody asked for, or protecting a format that never shipped, is a blocking finding, and so is a brief that asks for one.
- Treat zero-test passes, unquoted verification, and new warnings as failed tooling.
- Treat product prose written against the default rule as a blocking finding, and so is a user-facing string missing from the inventory.
- Label your own root-cause claims as confirmed (traced) or likely.
