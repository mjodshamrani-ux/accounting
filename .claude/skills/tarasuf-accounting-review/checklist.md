# Accounting review questions

Questions only. The rules they test are in the [accounting contract](../../../docs/reference/ACCOUNTING-CONTRACT.ar.md) and the CH entries of the [challenge register](../../../docs/reference/CHALLENGES.ar.md); do not copy them here.

| Area | Question | Contract and challenge |
| --- | --- | --- |
| Reading | Was every row read, with refused rows kept and explained? Is a missing value treated as zero anywhere? | [قراءة ومعنى المال](../../../docs/reference/ACCOUNTING-CONTRACT.ar.md#قراءة-ومعنى-المال), CH-09, CH-10 |
| Identity | Is the document number kept as text, with leading zeros and length? Could normalization make two references collide? | [قراءة ومعنى المال](../../../docs/reference/ACCOUNTING-CONTRACT.ar.md#قراءة-ومعنى-المال), CH-01 |
| Party and account | Same legal entity, party, account and dimensions on both sides? Is a customer code on one side being read as a supplier code on the other? | [النطاق والإشارة والفترة](../../../docs/reference/ACCOUNTING-CONTRACT.ar.md#النطاق-والإشارة-والفترة), CH-06 |
| Currency | One currency per comparison, with its minor units? Any amounts of different currencies summed into one figure? | CH-06 |
| Sign | Is the sign set by role or source evidence, not by whichever sign shrinks the difference? | [النطاق والإشارة والفترة](../../../docs/reference/ACCOUNTING-CONTRACT.ar.md#النطاق-والإشارة-والفترة), CH-16 |
| Dates and period | Which date applies: document, posting, value or report? Is the period complete, or only bounded by the first and last dates seen? | CH-05 |
| Members | For each group: members, evidence per member, and any other member set that fits the same evidence? | [العلاقات والمجموعات](../../../docs/reference/ACCOUNTING-CONTRACT.ar.md#العلاقات-والمجموعات), CH-02 |
| Reuse and capacity | Is any row or amount consumed twice? Does any allocation exceed what is open? | CH-02, CH-03 |
| Partial and remainder | Is partial allocation supported in this domain? Is the remainder shown? | CH-03 |
| Duplicates and reversals | Printed twice, or two real movements? Is a reversal paired with what it reverses, by evidence? | CH-07, CH-08 |
| Gross and net | Are fees, discounts and withholding separate roles, not netted silently? | CH-04 |
| Tolerance | Declared value, reason, scope and effect? Does it change an amount or close a difference? | [قراءة ومعنى المال](../../../docs/reference/ACCOUNTING-CONTRACT.ar.md#قراءة-ومعنى-المال), CH-16 |
| Status | Confirmed, suggestion or needs-review, each with its rule? Is a single "success" badge standing in for these? | [افصل الأسئلة قبل الإجابة](../../../docs/reference/ACCOUNTING-CONTRACT.ar.md#افصل-الأسئلة-قبل-الإجابة) |
| Bridge | Direction of the difference, opening, movement, closing, coverage; proven cause, hypothesis and unexplained remainder apart? | [الجسر وExcel](../../../docs/reference/ACCOUNTING-CONTRACT.ar.md#الجسر-وexcel), CH-13 |
| Reason | Can another reviewer verify each confirmed result from the sources and the stated rule? | CH-13, CH-14 |
| Old sessions | After a source, scope or policy change, are earlier decisions re-checked rather than carried over? | [المراجع والقوالب القديمة](../../../docs/reference/ACCOUNTING-CONTRACT.ar.md#المراجع-والقوالب-القديمة) |
