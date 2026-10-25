# Case families

Each row is a family to consider, the wrong engine it should catch, and the expected outcome type. Which outcome is right in a domain comes from its plan in [the roadmap](../../../docs/roadmap/README.ar.md); where a domain does not support a relation, the expected outcome is needs-review or refusal, not a match.

| Family | Variants | A wrong engine that should fail | Expected outcome type |
| --- | --- | --- | --- |
| Duplicates | printed twice on two pages; two real movements of the same amount; repeated header row | deduplicates real movements, or counts a reprint twice | keep both real movements; reprint flagged by evidence |
| References | leading zeros; prefix or spacing changes; a reference that names another document; similar references across parties | normalizes into a collision; trusts the first by order | match only on proven identity; else needs-review |
| Equal amounts | same amount, other party; same amount, other currency; two candidates in one party | takes the first candidate; matches across party or currency | no match across scope; needs-review when evidence cannot separate |
| Split payments | 1:N and N:1 with and without a shared reference; partial with remainder | consumes a row twice; exceeds capacity; hides remainder | exact members, remainder shown, or needs-review |
| Credit notes and reversals | reversal in a later period; partial credit; reversal of the wrong movement | nets unrelated rows; pairs by amount only | pair only by evidence; period kept |
| Currency | unknown code; KWD three decimals; JPY zero decimals; mixed currencies in one file | sums currencies; rounds silently | refusal or explicit choice; exact minor units |
| Rounding and tolerance | one minor unit off; at, below and above the declared tolerance | applies tolerance to close a difference | tolerance only as declared policy, effect shown |
| Sign | debit and credit columns swapped; signed amount column; parentheses negatives; "DR" after the amount | picks the sign that shrinks the difference | sign from role or source; refusal when unproven |
| Dates | document versus value date; cut-off day; ambiguous day-month order; Hijri text | infers period from first and last rows | period from scope; ambiguous dates refused |
| Incomplete inputs | truncated file; last page missing; last row damaged; formula without stored value | clean result from a prefix | visible error and the correct remaining work |
| Corrupt and limits | wrong extension; nested archive; oversized sheet or page count; DTD in XML | crash, hang or silent partial read | bounded refusal with reason |
| Metamorphic keep | reorder rows or columns without meaning; rename file; RTL and LTR; page break | members or facts change | identical facts and members |
| Metamorphic block | change currency, account, sign, member, cut-off or source with equal net | still confirms | confirmation withdrawn |

Machinery that already exists: [hard-case scenarios and gate](../../../audit/hard-cases/gate.mjs), [triage register](../../../audit/hard-cases/triage.mjs), [minimizer](../../../audit/hard-cases/minimize.mjs), [reliability manifest and splits](../../../audit/reliability/manifest.mjs), the bank holdouts under `audit/bank-statement-holdout-*` with their `check_seal.py`.
