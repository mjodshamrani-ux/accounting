# Working on Tarasuf

Tarasuf (تَـراصُـف) is a local-first reconciliation application, not a generic matching demo. Start at [the project portal](docs/README.ar.md). These instructions apply across this repository; direct user instructions take precedence.

## Read before changing code

1. [Current execution queue](docs/CURRENT-PLAN.ar.md) and [verified baseline and gaps](docs/reference/STATE.ar.md).
2. [Vision and product decisions](docs/reference/VISION.ar.md), [accounting boundaries](docs/reference/ACCOUNTING-CONTRACT.ar.md), [architecture](docs/reference/ARCHITECTURE.ar.md), and the relevant [domain plan](docs/roadmap/README.ar.md). For engine work, map the task to the [accountant and engine challenge register](docs/reference/CHALLENGES.ar.md); its acceptance families are proposals, not newly passed tests.
3. [Quality and evidence rules](docs/reference/QUALITY.ar.md), the relevant incidents in [development lessons](docs/reference/DEVELOPMENT-LESSONS.ar.md), and the [source-diversity protocol](docs/roadmap/source-diversity.ar.md) for engine/test work. Changing seeds, values or row counts does not establish a new source structure; verify the oracle and serialized input as well as the engine. The protocol is planned work inside the current queue, not a completed evaluation. For UI work also read [design](docs/reference/DESIGN.ar.md) and [workspace identity](docs/WORKSPACE-IDENTITY.ar.md). For AI/OCR read [AI boundaries](docs/reference/AI-AND-OCR.ar.md) and the [local AI and assistant implementation roadmap](docs/roadmap/ai-local-assistant.ar.md). The latter separates existing capabilities from planned contracts, requires evidence-bound proposals and read-only explanations, and defines privacy and ordinary-device activation gates; it does not authorize a model download or cloud fallback.
4. Inspect the actual implementation, domain contract, existing tests and Git state. Do not infer completion from a plan, a release-note title, a demo or an old passing run.
5. For future accounts, owner statistics, organizations, trials or billing, read the [private-data boundaries and commercial roadmap](docs/roadmap/accounts-privacy-business.ar.md). It is planned work, not permission to enable tracking now. GitHub remains the source repository; a commercial account service requires suitable production hosting, a minimal metadata contract and its security gates before activation.

## Non-negotiable engineering boundaries

For visual implementation, use the [scene construction and motion reference](docs/reference/VISUAL-IMPLEMENTATION.ar.md): exact component sources, SVG layering/A4/clipping, shared upload behavior, CSS perspective, reveal logic, provenance and existing browser checks. Reuse the source artwork and real input controls. Do not infer live 3D physics, cursor parallax or financial progress from decorative layer names or animation.

- Deterministic, source-bound accounting is authoritative. Equal sums alone do not prove document identity, group membership, completeness or full balance reconciliation.
- Preserve source bytes, hashes, physical rows/cells/pages, rejected rows, reasons, decisions and remaining differences. Do not discard competitors to manufacture uniqueness. Keep partial useful results when isolation is proven; preserve existing stricter domain gates until a separately tested contract changes them.
- AI can propose interpretation; it cannot invent money, rewrite evidence, approve a match, hide a difference or certify completeness. A runtime/model being present does not prove useful inference.
- Financial files stay local. Do not add telemetry, remote financial processing, external fonts or automatic model downloads. Session/workbook downloads contain user data and are not encrypted by this app. Never publish user files, raw local proofs, personal paths or secrets.
- Retain original supplier upload SVG, shared page sections, one type selector, genuine licensed Thmanyah headings, local fonts, AR/EN, reduced motion, accessibility and state retention. Visual source order must not change financial source-array order.
- App version, engine version and session/protocol versions are separate. Branding changes must not silently migrate evidence formats or rename protocol identifiers such as `mizan-accounting-v1`.
- Never weaken a frozen oracle, expected amounts/members, mutation gate, publication guard or source contract to get green tests. Retain failures as historical failures; create a fresh holdout after learning from a case.

## Delivery

Use [delivery guidance](docs/reference/DELIVERY.ar.md). Keep changes scoped, inspect concurrent changes, and run checks appropriate to the change plus the unchanged required CI gates. Update documentation in the same change when behavior or scope changes. The exact public allowlist must include reviewed documentation changes too; do not bulk-approve unknown files or regenerate distribution hashes for a docs-only change.

Report what changed, what actually ran, what failed or remains unverified, and the exact commit/run when available. Do not claim universal accuracy, field validation, measured time savings or a successful deployment without corresponding evidence. An old run belongs to its old commit. A documentation update does not change the application release number.
