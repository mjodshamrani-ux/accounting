---
name: tarasuf-ai-integration
description: Evaluate AI and OCR proposals in Tarasuf against the project's AI boundaries. AI may suggest a column role, a document relation or a description meaning from existing evidence; the deterministic engine decides. Use when reviewing or changing the existing suggestion paths (local-ai.ts, local-import-ai.ts, import-proposals.ts, visual review), and whenever someone proposes adding or calling a model, hosted LLM API, provider, OCR engine, chat or download. تقييم اقتراحات الذكاء الاصطناعي وOCR، المساعد المحلي، مزود نموذج أو واجهة LLM. Evaluation only. This skill does not authorize adding AI, dependencies, downloads, network calls or product changes.
---

# Tarasuf AI integration

AI is a proposal layer. It never invents an amount, changes a sign, drops a row, writes a balancing figure, or approves a group.

## When to use

- Reviewing or changing `lib/reconciliation/local-ai.ts`, `local-import-ai.ts`, `import-proposals.ts`, `assistant.ts`, `domain-assistant.ts`, or the `visual-*.ts` review path.
- Evaluating a proposal to add a model, provider, OCR engine, chat or download.

## When not to use

- Ordinary engine work with no AI path: `tarasuf-engine-development`.
- Planned AI-1 to AI-3 and OCR-1 delivery: those need the user's explicit decision first; this skill only evaluates.

## Inputs

- [AI and OCR boundaries](../../../docs/reference/AI-AND-OCR.ar.md) and the [local AI and assistant roadmap](../../../docs/roadmap/ai-local-assistant.ar.md).
- `tests/ai-evidence-boundary.test.ts`, `tests/assistant-adversarial.test.ts`, `tests/visual-boundary.test.ts`, and `audit/local-provider/contract.json`.

## Steps

1. Classify the request: existing capability, planned item (AI-1, AI-2, AI-3, OCR-1), or new. A planned item is not authorized because it is written down.
2. If it adds a model, provider, download, network call, dependency or data leaving the device, stop and ask the user. Record licence, size, memory, devices, language, cost of first run and the privacy change it implies; do not implement.
3. For a suggestion path, check the envelope: task id, source fingerprint and reading version, evidence positions, a role from an allowed list or existing row ids, a reason, and the option to abstain. Reject ids outside the evidence window, a changed source, or extra authority in the output.
4. Check the engine re-derives every amount, member and status from the source after the suggestion. Equal totals after a suggestion do not prove the suggested context.
5. Test with adversarial content: an instruction hidden in a cell, a question asking to ignore a difference, two equal groups, a stale result, a changed source mid-run, and an out-of-scope question. A failure to understand must not change an engine result.
6. Measure usefulness against the engine alone on the same families: correct completed cases, human corrections, time, and misleading suggestions. Without a measured gain, the path stays off.

## Outputs and evidence

- The classification, the authorization needed if any, envelope checks, adversarial results, and the measured comparison or "not measured".

## Acceptance, failure and escalation

- Accept only with zero unauthorized financial change, zero wrong approvals, and a gain that was defined before measuring.
- Any new provider, download, network flow or dependency without the user's authorization is a failure. Escalate with the facts from step 2.

## Limits and related skills

- A model's availability or valid JSON is not semantic usefulness. Human correction of an image is not OCR success.
- `tarasuf-privacy-security` covers the data flow; `tarasuf-accounting-review` judges results; `tarasuf-adversarial-testing` builds the cases.

## Example

A proposal: let a hosted model map columns for unclear headers. Classification: new, outbound data. Stop and ask the user; list what would leave the device and the privacy text it would change. Meanwhile check the existing local path: a hidden instruction in a header cell must not change the mapping or any amount.
