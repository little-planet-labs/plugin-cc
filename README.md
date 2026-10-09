![Solarpunk code factory with solar panels, wind turbines, conveyor belts, and a robotic arm](assets/brand/solarpunk-factory-hero-v5.png)

# Little Planet Labs Claude Code plugins

A [Claude Code](https://code.claude.com) plugin marketplace from Little Planet Labs.

| Plugin | What it does |
|---|---|
| [Little Planet Factory](#little-planet-factory) | A team of agents that plans, delegates, implements, and inspects multi-part work |
| [Music Video](#music-video) | Turns a company into a song and a beat-synced music video about it |

## Install

```
/plugin marketplace add Little-Planet-Labs/plugin-cc
/plugin install little-planet-factory@little-planet-labs-cc
```

To roll it out to everyone working in a repo, add this to the repo's `.claude/settings.json`. Claude Code prompts teammates to install it when they trust the folder:

```json
{
  "extraKnownMarketplaces": {
    "little-planet-labs-cc": {
      "source": { "source": "github", "repo": "Little-Planet-Labs/plugin-cc" }
    }
  },
  "enabledPlugins": {
    "little-planet-factory@little-planet-labs-cc": true
  }
}
```

## Little Planet Factory

Six agents that split a task into units of work, run them in parallel where they can't break each other's builds, and don't call it done until it has been checked.

```
overseer            you talk to this one
├── researcher      answers one question, with cited findings
├── worker          small, well-defined units
├── manager         complex sub-tasks
│   ├── researcher
│   ├── worker
│   ├── worker
│   └── inspector   reviews the manager's sub-task
├── inspector       reviews units and the combined result
└── signoff         confirms everything asked for is done
```

### Start a session

Run Claude Code as the overseer:

```
claude --agent little-planet-factory:overseer
```

Or make it the default for a project in `.claude/settings.json`:

```json
{ "agent": "little-planet-factory:overseer" }
```

The overseer replaces the default Claude Code system prompt for that session. To run subagents on sonnet instead, see [Lite tier](#lite-tier).

### Long sessions

The overseer keeps a small ledger of its working state in the session scratchpad: the agents it has running, review rounds, and Linear state. The plugin's SessionStart hook tells the overseer where the ledger is and puts it back into context after compaction or when you resume a session, so auto-compaction doesn't make it lose track of that work. Turn on auto-compact in `/config` for long runs, such as working through a Linear board overnight. The hook needs Node.js, and does nothing if `node` isn't on your PATH.

### Status mod

In an overseer session the plugin also loads a mod that shows the factory's state inside Claude Code. The mod needs Claude Code 2.1.287 or later, where mods are on by default. Versions without mod support ignore it, and the rest of the plugin keeps working.

- **Band above the prompt.** A card with colored gauges for context and the 5-hour and 7-day rate limits (green, yellow, red as they fill, with the 5-hour reset countdown), a chip per agent with a status dot (running first; identical agents share a chip with `×N`; descriptions share the width and are cut in the middle when they must be; the rest fold into `+N`), the ledger's next step, and the open question count. Press `1` at an empty prompt to open `/factory` (below 26 columns the band leaves the button out, so use `/factory` there). On a narrow or short terminal it drops the 7-day gauge, then the chips, down to one line. Other mods' rows in the band stay under it.
- **Agent rows.** A summary card above each Agent row in the transcript: status dot, agent type, description, model, and elapsed time. The row itself, with its progress, detail, and token count, stays under the card. Other tool rows are unchanged.
- **Spinner.** While agents run, the spinner adds how many are running and the next step.
- **Toasts.** One when an agent finishes or fails (with its elapsed time and tokens), and one when the 5-hour or 7-day limit passes 80%, again only after it drops below 70% or the window resets.
- **`/factory`.** Opens a pane with usage gauges (context, tokens left before auto-compaction, the 5-hour and 7-day rate limits, and session cost), the agent tree from the overseer down through managers to workers (each with its status, model, elapsed time, and tokens, counted as Claude Code counts an agent's tokens), and a summary of the ledger: its status, next step, open questions, units by state, background work, and each manager ledger's next step.
- **Compaction reminder.** When context reaches 90% of the auto-compaction threshold, or 75% of the window when the threshold isn't known, it tells the overseer once to bring its ledger up to date. It reminds it again after the next compaction.

The mod only reads the ledgers in the session scratchpad and never writes a file. In any other session it shows nothing and adds nothing to the model's context.

### The agents

**Overseer** (`little-planet-factory:overseer`) is the controller. It scopes the work, breaks it into units that don't touch the same files, and hands them to workers and managers, in parallel only when they don't build together: units where either's build compiles the other's files in one working tree run one after another, and one that stops unfinished holds the rest up until it's done or you decide. It doesn't write code unless you tell it to. It launches agents in the background so you can keep talking to it while they run: ask questions, add work, or redirect an agent mid-task. It owns final quality. Work isn't done until every unit has reported back, it has read every diff, verification passes, every required inspection has come back clean, and it has cleaned up the build output agents reported.

**Manager** (`little-planet-factory:manager`) sits between the overseer and a group of workers when a sub-task is too complex to hand to one worker. It decomposes the sub-task, runs it across workers, integrates and verifies the result, runs its own inspection, and reports a summary so the overseer doesn't have to track the detail. It makes low-risk calls itself and lists them as assumptions. It comes back to the overseer with anything that changes scope or a shared interface. In the full tier, it picks opus or sonnet for each worker based on the unit's difficulty and risk. It never uses haiku for a worker, and nothing above opus unless you ask for it.

**Researcher** (`little-planet-factory:researcher`) answers one question for the overseer or a manager before it plans or writes a brief: how an external library or API behaves, an end-to-end root-cause trace, or a broad sweep across repos, the knowledge vault, or tickets. It's read-only. Every finding is labeled either confirmed, with its source, or inferred. Findings are verified wherever possible; an unverified one is a last resort and must say what was tried and why it can't be checked. Leads send research back for up to three rounds per question, then you decide. It runs on sonnet by default, plain sweeps included, and in the full tier on opus for hard tracing. It isn't for scoping the files the lead is about to split; the lead reads those itself.

**Worker** (`little-planet-factory:worker`) implements one unit. It stays inside the files it was assigned, matches the surrounding code's conventions, runs targeted checks, and reports what it changed and what it assumed. It can't spawn other agents.

**Signoff** (`little-planet-factory:signoff`) is the last gate, and only the overseer invokes it. After inspection passes, it turns the source of truth into a checklist and checks each item against evidence in the code. The source can be a Cadence spec, a ticket or issue, a document, or your own request, including anything you added mid-session. It checks off verified spec criteria, flags loose ends (TODOs, skipped tests, stale docs, unresolved follow-ups, build output left behind without a reason), and runs a language pass: it verifies the copy inventory, flags existing copy the change made wrong, and flags terminology decisions. Those decisions come to you as interview questions. It doesn't rewrite prose itself. Git writes and the final report wait for SIGNED OFF. Under `pull-request`, it runs a second pass once the PR is open and its comments are triaged. It reads the PR itself and checks that every review comment was fixed or answered, and the work isn't reported done until that pass signs off too.

**Inspector** (`little-planet-factory:inspector`) reviews a change against its definition of done: brief compliance, correctness, security, efficiency, tooling, whether units from different agents fit together, and maintainability for broad changes. It's read-only. When the [Codex plugin](#optional-integrations) is set up, it also runs a Codex review alongside its own and keeps only the Codex findings it confirms. It returns a PASS / PASS WITH NOTES / FAIL verdict with each blocking finding tied to a file, and the lead sends that finding back to whoever owns the file. You can also call it directly for a review.

### Models

Every subagent except the researcher (sonnet) is pinned to opus, so the model you start the session on doesn't carry down to them. Agents without a pin, such as Claude Code's built-in agent types, get an explicit model of opus or sonnet on every call. Leads can downgrade per call: sonnet for a mechanical worker. No agent runs on haiku. Nothing runs above opus unless you ask for it, and then only for the work you named. The overseer runs on whatever model you start it with. The [lite tier](#lite-tier) changes these defaults.

### Lite tier

To spend less on subagents, start the session with `LPF_TIER=lite`:

```
LPF_TIER=lite claude --agent little-planet-factory:overseer
```

Only the environment variable sets the tier. Without it, or with any other value, the factory runs as described above.

In lite, managers stay on opus, and the overseer runs on whatever model you start it with, as usual. Workers, inspectors, researchers, signoff, and Claude Code's built-in agent types all run on sonnet. Leads never quietly bump a unit to opus. Foundational units and inspection triggers run on sonnet with their usual gates. Only when a unit hits the three-round limit does the overseer ask you whether to keep it on sonnet or run that one unit at full tier, and it moves to opus only if you say yes. Because the inspector is on sonnet, every lite inspection asks for the [Codex](#optional-integrations) second review, repair rounds included, when Codex is set up. Every other gate stays the same.

The SessionStart hook tells the overseer the session is lite, and a hook on agent spawns denies a worker, inspector, researcher, signoff, or built-in agent that isn't on sonnet, unless it's marked as a unit you approved for full tier. Manager spawns pass through and keep their opus pin. Forks are always denied in lite, since a fork runs on its caller's model whatever model the call asks for. The spawn hook only acts when the caller is a factory lead, the overseer session or a manager, so a plain Claude Code session or any other agent with `LPF_TIER=lite` set is left alone. Claude Code runs plugin hooks inside subagents too, so the spawn hook also covers the spawns managers make, and the managers' own instructions carry the same rule. Both hooks need `node` on your PATH. The tier comes from the SessionStart hook, so without `node`, or if `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` keeps `LPF_TIER` from reaching the hooks, the overseer isn't told the session is lite and the whole session runs at full tier.

### When inspection runs

The overseer and managers send work to the inspector when:

- you ask for a review
- the change touches a database or migrations, auth, security, telemetry, or an external integration
- it's a risky refactor
- the diff is broad: more than one logical area, 4+ files, about 150+ changed lines, or behavior shared across routes, components, or tools

The overseer applies this to each unit and again to the combined change, since several small units can add up to a broad one. Small, low-risk edits skip inspection but still get verified.

### Skills

The agents share ten skills beyond the platform guidance.

**Version control** (`version-control`) is preloaded into every agent. Before any git command that changes state, the agents work out the project's policy, then stay inside it:

| Policy | What the agents do |
|---|---|
| `none` | Edit the working tree and leave everything uncommitted. This is the default when a project says nothing. |
| `commit` | Commit verified changes on the current branch. Never push. |
| `push` | Commit on the current branch and push it, e.g. straight to `main`. No branches or PRs. |
| `pull-request` | Branch, commit, push the branch, and open a pull request. Never commit to the base branch. |

The policy comes from, in order: what you say in the session, then the project's `CLAUDE.md` or `AGENTS.md`, then the `none` default. Repo conventions like a PR template shape *how* the agents branch and write messages, but never grant a higher level. Conflicts resolve to the more restrictive reading. To state a policy unambiguously, add this to the project's `CLAUDE.md`:

```markdown
## Version control

policy: pull-request
base: main
branch: <type>/<ticket>-<short-description>
commit-style: conventional
merge: never
```

Only `policy` is required. GitHub operations go through the `gh` CLI, one bare command per call, with no loops, polling scripts, or chained writes. Two exceptions: the Copilot review wait and the open-PR watch below, both bounded (or self-ending), read-only loops that run in the background. Under every policy, the agents stage explicit paths, never force-push, never skip hooks, never change git config, and never discard work they didn't create. Only the overseer runs git writes, once the work passes verification and inspection. Managers and workers never commit, because they share a working tree with agents still in flight.

**Copilot review.** When the agents open a PR on github.com, the overseer requests a GitHub Copilot review with `gh` (2.88 or newer), unless the repo already asked for one, and waits for it in the background for up to about 15 minutes. Then it triages every comment on the PR: review threads, review summaries, and conversation comments, from Copilot or anyone else, you included. Valid ones are fixed through the usual worker and inspection flow, pushed to the PR branch, and their threads resolved. The rest get a short reply saying why they don't apply and stay open for a person to weigh in. Replies post under your GitHub account. A PR gets at most two Copilot rounds, and signoff then checks the PR itself before the work is reported done. If Copilot isn't available, or `gh` is older than 2.88, the overseer notes it and still triages the comments. On another forge or GitHub Enterprise Server, or when no PR was opened, comments aren't checked, and a one-line note says so. While a PR stays open, the overseer also keeps one read-only watch on it in the background, snapshotting its reviews, comments, state, and checks, and it wakes the overseer the moment any of them changes — a new review, a comment, a CI result, or a merge — so nothing has to be pointed out. It restarts after every write the overseer makes on that PR, and stops once the PR merges or closes. A Copilot review that lands after the two-round cap still gets triaged, just not requested again.

**React apps** (`react-apps`) and **Xcode projects** (`xcode-projects`) load when the project uses that stack. They cover how to detect the tooling, how to verify with commands that exit (no dev servers, and no taking over your simulator), what to leave alone (lockfiles, signing, generated project files), which shared files need a single owner when work is split across agents, and what the inspector should weight in review. Agents build Xcode projects at low priority, with all agent builds together capped at half the cores, in a per-repository DerivedData folder outside Xcode's default and excluded from Time Machine, and run scoped tests with no host app on the Mac instead of a simulator. Tests hosted in your app, including UI tests, run on the Mac only if your `CLAUDE.md` has `mac-hosted-tests: allowed` under an `## Xcode` heading. For a Mac-only app without it, the overseer asks you first. The overseer assigns per-session slots for concurrent builds and cleans them up. Units in one app (with its frameworks and local packages) or one TypeScript project build together, so they run one after another. Test runs pass `-collect-test-diagnostics never`, since a failing run otherwise hangs collecting a sysdiagnose. Temporary source edits, like mutation checks, run only as the tree's sole builder, in a trap-guarded script that backs up, edits, tests, and restores — comparing before it overwrites, and recovering if a kill or crash skipped the trap. The overseer runs a stall watchdog in the background, and any process it or an agent ends must be one it can prove it started, by a PID it recorded rather than a shared path.

**Quality bar** (`quality-bar`) is preloaded into every agent. It aims for no bugs on the first pass, so review confirms quality rather than discovering defects. Foundational work gets the full bar:
- **What counts as foundational:** persistence, schemas, sync, shared interfaces, auth, and concurrency.
- **Pre-mortem:** before dispatch, the lead lists invariants and failure modes, and each becomes a named test.
- **Per-unit inspection** before integration.
- **At least two review rounds.**

Everything else gets the normal inspection heuristic. Every repair diff is re-reviewed. After three review rounds on a unit, repairs stop. The overseer decides what has to change before work resumes: the brief, coordination between units, the agent, or the approach. It asks you when the decision is yours. Signoff's re-runs have the same limit. Claims and verification output are checked rather than trusted: a 0-test "pass" isn't a pass. Agents don't write product prose by default. Short labels are fine if they're listed in the copy inventory. A project's `CLAUDE.md`, or asking in the session, turns this off.

**Asking questions** (`asking-questions`) is preloaded into the overseer, manager, worker, and signoff. The researcher and inspector don't ask. When a decision is yours, it asks through the interview-question UI: each question has a sentence or two of self-contained context, one decision, and two to four options with their consequences, with a recommendation first. No questions are buried in prose, and none of its messages end with an inline "want me to…?". Managers and workers pass questions up in the same shape, and the overseer merges them into one interview.

**Vercel** (`vercel`) loads when a project deploys to Vercel. Deploys happen only by pushing to git, never with `vercel deploy`, `--prod`, `redeploy`, `promote`, or `rollback`, unless you ask for that specific action. Pushing still follows the version-control policy, so under `none` or `commit` the agent reports that the change is ready to deploy rather than deploying it. Unless you ask otherwise, every Vercel project gets Vercel Web Analytics and Speed Insights; the agent adds the components and tells you when Web Analytics still needs enabling in the dashboard. Neon is never used, whether directly, through the Vercel Marketplace, or as the former Vercel Postgres. When a project needs a database, the agent asks you which one. The skill also covers env vars (pull from Vercel, never hand-edit `.env` files, never handle secret values), function limits and costs, Next.js-on-Vercel rules, build file tracing, Blob access, and debugging from logs instead of redeploying.

**Next.js** (`nextjs`) loads when a project depends on `next`, on any host, alongside `react-apps`. Unless you ask otherwise, every site gets a dynamically generated Open Graph image through the `opengraph-image` file convention, and images go through `next/image` rather than a plain `<img>`. It covers the Metadata API and metadata file conventions, `next/image`, `proxy.ts`, hydration safety, Next 16 caching and `"use server"` rules, route-level CSS, and toolchain pins, labeled with the version they were verified on.

**Web design** (`web-design`) loads for any project that builds web pages or sites, whatever the framework. It covers SEO (titles, meta descriptions, canonical URLs, robots and sitemaps, structured data), favicons and app icons, tab titles (no em-dashes), social cards, theming meta, and accessibility and motion rules. The `nextjs` skill implements these in Next.

**Linear** (`linear`) needs the Linear MCP connected. It loads when the project's `CLAUDE.md` has a `## Linear` block or you ask the overseer to work or refine tickets in Linear. The block names the project and a status mode: `comment-only` (the default), `to-review`, or `to-done`. Each session is pinned to that one project, so agents never list or work tickets from another project, even one in the same team. Unassigned Todo tickets are ranked by priority and, once you confirm them, run in batches of up to four that don't touch the same files or build together, with each other or with a paused, blocked, or halted ticket's unfinished work. Backlog tickets are refined with you and moved to Todo. Only the overseer writes to Linear. The overseer posts formatted Started, Progress, Paused, Blocked, and Done comments so teammates can follow along, plus a progress note when a ticket goes about an hour without one, when the session's scheduler is available.

**Codex review** (`codex-review`) is preloaded into the inspector, the only agent that uses it. It runs the optional Codex second review described under [Optional integrations](#optional-integrations).

### Optional integrations

The agents use two MCP servers, Cadence and Telescope, and one Claude Code plugin, Codex, when they're available, and work normally without them. The `linear` skill is the exception: it needs the Linear MCP and stops if it isn't connected.

**[Cadence](https://cadencecode.dev/)**
- **Knowledge vault.** Agents search it before non-trivial work. The inspector checks changes against decisions stored there. The overseer saves new durable knowledge.
- **Specs.** When you name a spec ("implement spec 14"), or a Linear ticket you ask for links one, its success criteria become the definition of done.
- **Reports and other output.** Reports are built as Cadence reports rather than artifacts. Slides, files, notes, and anything else Cadence has a tool for go through Cadence.

**[Telescope](https://telescope.littleplanetlabs.com/)**
- **Upstream incidents.** Before debugging a failure that involves an external service, agents check Telescope for a live incident at that provider.
- **Matched incident.** If there is one, the agent reports it with a link to the provider's status page instead of changing code to work around it.

**[Codex](https://github.com/openai/codex-plugin-cc)**
- **Second reviewer.** When the Codex plugin is installed, enabled, and signed in, the inspector runs a Codex review of the change alongside its own. Foundational or risky changes also get an adversarial review. Codex only reads the code, and only the inspector runs it.
- **Confirmed findings only.** The inspector checks each Codex finding against the code. Only the ones it confirms are reported as findings, tagged `[Codex]`, and rejected ones get a one-line note. Codex never decides the verdict.
- **Never a blocker.** If Codex runs out of usage, fails, or is slow, the inspection notes it in one line and carries on. Every wait is bounded.
- **Not installed.** If Codex isn't installed or is disabled, nothing changes and nothing is mentioned.

Agents detect Cadence and Telescope by their tool names, so it doesn't matter what name you gave the server when you connected it.

## Music Video

Makes a kinetic-typography music video about any company. It researches the company, offers you a menu of song topics, writes lyrics and a Suno prompt, and, once you've made the song in Suno, builds a beat-synced Remotion video with its own look. No two videos share a visual style.

```
company → research → topic menu → lyrics + Suno prompt → your Suno song → alignment → direction → video
```

You approve each step that matters: the brief, the topics, the lyrics, and the creative direction.

### Install

```
/plugin marketplace add Little-Planet-Labs/plugin-cc
/plugin install music-video@little-planet-labs-cc
```

### Start

Invoke the `music-video` skill:

```
/music-video:music-video
```

It interviews you about the company first, including how its name is pronounced.

### What it gives you for Suno

Suno gets two things from the plugin: the lyrics and a style description. You generate the song in Suno yourself, then hand the audio file back.

### Requirements

- Node.js 22.18 or newer, and pnpm
- ffmpeg
- Python 3.12 or newer
- A Suno account

The first alignment run downloads about 1.4 GB of models into the project.

## Repository layout

```
.claude-plugin/marketplace.json            marketplace manifest
plugins/little-planet-factory/
  .claude-plugin/plugin.json               plugin manifest
  agents/                                  overseer, manager, worker, researcher, inspector, signoff
  skills/platform-tools/                   Cadence and Telescope guidance, preloaded into every agent
  skills/version-control/                  git policy resolution and safety rules, preloaded into every agent
  skills/react-apps/                       React web app conventions, loaded on demand
  skills/xcode-projects/                   Xcode and Swift conventions, loaded on demand
  skills/quality-bar/                      foundational tiering, pre-mortems, review and copy rules, preloaded into every agent
  skills/asking-questions/                 interview-style questions to the user, preloaded into all agents but the researcher and inspector
  skills/vercel/                           Vercel deploy rules and platform defaults, loaded on demand
  skills/nextjs/                           Next.js conventions and defaults, loaded on demand
  skills/web-design/                       framework-agnostic SEO, icon, title, and design rules, loaded on demand
  skills/linear/                           Linear project workflows, loaded on demand
  skills/codex-review/                     optional Codex second review, preloaded into the inspector
  hooks/                                   SessionStart hook that points the overseer to its ledger and re-injects it (factory-ledger),
                                           PreToolUse hook that keeps lite-tier spawns on sonnet (lite-tier.mjs, lite-tier.sh),
                                           and the status mod (register.ts, with its code in mod/)
  types/index.d.ts                         the status mod's session state types
  tests/                                   status mod tests, run with claude plugin test
plugins/music-video/
  .claude-plugin/plugin.json               plugin manifest
  agents/                                  company-researcher, lyricist, video-director
  skills/music-video/                      the playbook you invoke, with its user checkpoints
  skills/suno-songwriting/                 lyrics package and Suno prompt format
  skills/brand-extraction/                 brand colors, fonts, and logo into src/brand.json
  skills/scene-authoring/                  creative direction and scene-building craft
  skills/remotion-pipeline/                analysis, alignment, and render pipeline
  skills/remotion-pipeline/template/       the Remotion project each video starts from
tests/                                     tests for the ledger and lite-tier hooks, not shipped with the plugin
```

## Development

Validate after editing:

```
claude plugin validate .
claude plugin validate plugins/little-planet-factory
claude plugin validate plugins/music-video
```

Run the hook tests (needs Node.js):

```
sh tests/factory-ledger-hook.test.sh
sh tests/lite-tier-hook.test.sh
```

Run the status mod tests (needs Claude Code 2.1.287 or later, the first version with mods on by default). They live in `plugins/little-planet-factory/tests/`, because `claude plugin test` only runs tests inside the plugin folder, so they ship with the plugin:

```
claude plugin test plugins/little-planet-factory
```

Check the music-video template in a copy, never inside the plugin folder, so no `node_modules` lands in the plugin:

```
cp -R plugins/music-video/skills/remotion-pipeline/template /tmp/mv-template-check
cd /tmp/mv-template-check
pnpm install
pnpm typecheck
pnpm test
```

Test locally from a clone:

```
/plugin marketplace add ./path/to/plugin-cc
/plugin install little-planet-factory@little-planet-labs-cc
```

Bump `version` in both `plugins/little-planet-factory/.claude-plugin/plugin.json` and the plugin's entry in `.claude-plugin/marketplace.json`, then tag the release with `claude plugin tag`, which checks that the two agree.

---

<a href="https://littleplanetlabs.com"><img src="assets/brand/little-planet-labs-logo.svg" alt="Little Planet Labs" width="132"></a>
