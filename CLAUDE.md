# Tarasuf cloud handoff

For UI work, use [tarasuf-ui-craft](.claude/skills/tarasuf-ui-craft/SKILL.md), a thin entry to the canonical project skill. Its Audit/Refine/Design/Review modes supplement, and do not override, the instructions and financial contracts below.

Read [AGENTS.md](AGENTS.md) first, then the [Arabic project portal](docs/README.ar.md) and [current execution queue](docs/CURRENT-PLAN.ar.md). They are the maintained project reference for Claude, Codex and other contributors.

Claude Code reads this file instead of AGENTS.md when both exist, so AGENTS.md is imported here and loads with it:

@AGENTS.md

The portal links the vision, verified implementation snapshot, architecture, original visual identity, accounting/AI/privacy boundaries, and a separate development plan for each of the 12 current workspaces. Future work is explicitly marked as planned; do not treat it as implemented.

For engine work, read the [challenge register](docs/reference/CHALLENGES.ar.md). It connects accountants' problems to source evidence, dangerous shortcuts, domain plans and proposed acceptance cases. In particular, equal totals and full row coverage can still conceal incorrect group membership. Start by checking existing protections; do not mistake a documented risk for a newly confirmed code defect or a proposed test for a passing result.

Future accounts, owner dashboards, company seats and free trials are scoped in the [privacy and commercial roadmap](docs/roadmap/accounts-privacy-business.ar.md). These are not implemented. Keep financial processing local, separate operational account metadata from optional analytics, and do not activate tracking, identity providers or billing merely because the roadmap exists. Read its hosting and local-only quota limitations before proposing implementation.

Read the relevant [development incidents and lessons](docs/reference/DEVELOPMENT-LESSONS.ar.md) before repeating an earlier fix. Distinguish user-reported symptoms, reproduced causes, historical fixes and currently verified results. For engine testing, apply the [source-diversity protocol](docs/roadmap/source-diversity.ar.md) within C-0 and the chosen domain: vary evidence structure, producer, semantics and economic relationships, then scale volume. More seeds of one layout do not establish generalization. Preserve failed evaluations and test the verifier itself; do not silently reclassify hard positives to improve a score.

Work from the current repository state. Private local evidence paths are intentionally not required for a cloud checkout. Public code, synthetic contracts, test runners and GitHub runs are the reproducible references. Follow the delivery guide and record any unavailable evidence honestly.

For visual work, read the [scene construction and motion reference](docs/reference/VISUAL-IMPLEMENTATION.ar.md) alongside the design guide. It maps the original SVG papers, scan and portal, shared upload art, dimensional features and privacy window, scroll reveal, timing, clipping, provenance and regression checks. Preserve the native file input, reduced motion and keyboard access; decorative motion is not engine progress. External inspiration sites are not the editable source of Tarasuf artwork.

## Skills, rules and checks

Project skills live in `.claude/skills/`, short standing rules in `.claude/rules/`, and one local hook in `.claude/settings.json`. The [skills map](docs/reference/SKILLS.ar.md) says which skill and which checks fit each kind of task, what was evaluated, and how to turn each part off. Skills and rules guide Claude Code only, and the hook watches only Claude Code's file-edit tools. None of them is a security boundary or replaces CI, the public-content guard or review.
