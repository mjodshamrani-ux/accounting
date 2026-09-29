# Partial reconciliation: independent development evidence

The frozen corpus contains sixteen bounded synthetic contracts with **14 exact
positive pairs and one complete 2:2 payment group** required. Full literal sources,
expected members, policy, provenance and reproduction are in `frozen/README.md`.
This is synthetic development evidence. PR08/PR09 explicitly reuse known source
integrity hazards as regression controls; the other fixtures are newly authored.

Freeze time: 2026-09-29T12:14:33.536578Z, before any candidate execution.
No upcoming engine implementation or new unit fixtures were inspected during
authoring. This is not a claim that all implementation edits began after freeze.

Manifest SHA-256:
`0b10b982659d984e9298082c0a76bb183fcd6d30abb8c34a5be520fed9a57e7e`.
Contracts SHA-256:
`bfd08fb1c316666b65fd5be45888233c44af67200bb91b11366723b3b0a5d956`.
Runner SHA-256:
`4bf5a897a7d35fc8f92d405a3b97e0aa9cbb01035658227a6aa1942c1695d593`.

## Preserved baseline b9917ce

`baseline-b9917ce.json` records one contract execution against an immutable
`git archive` of `b9917ce16040d082ef4e437cfb3689bab5074978`, engine0.3.20.
All57 library files matched the commit before and after, with frozen inputs unchanged.

- 4/16 contracts passed: the three expected source/format refusals (PR08, PR09,
  PR16), plus PR13's unaffected pair beside an excluded payment competitor.
- 1/14 required exact pairs completed; 0/1 required whole payment groups completed.
- Zero observed false automatic approvals.
- Twelve other contracts threw unexpected production operation exceptions,
  preventing their required partial results. No required completion is credited
  for a safe refusal. PR01 could not reach its session/export phase.

The preceding archive-setup attempt failed because the local Python version
does not support `tarfile.extractall(filter=...)`. The runner then stopped at
missing-library startup before any engine import or contract execution. Recovery
used system tar on the still-empty archive directory; the setup issue is recorded
separately in `baseline-b9917ce.provenance.json` and is not counted as an engine run.

Retain all failed results, exact frozen bytes, and before/after hashes. Do not
revise required financial pairs or classifications after seeing an output. Any
necessary evaluator correction must be separately versioned with its reason and
the original outcome preserved.
