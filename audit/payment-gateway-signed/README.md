# Signed-kind gateway synthetic corpus

This independently computed raw CSV/OOXML and literal financial corpus contains 58 bundles and 232 originals, copied unchanged from the sealed precode preparation. PROVENANCE.json pins that inventory. No field originals are present. Expected declarations and the oracle were authored independently of product execution; neither is attributed to a human reviewer.

The product test suite preserves the unchanged native reader boundary: two precode native positive originals use a worksheet path/font representation outside that boundary and are rejected. Supported native shared/inline cells and literal/serial dates are exercised separately. An oracle result is not a product result or field validation.

Run the assertion oracle with an explicit output directory outside this corpus. Maintained product tests, direct proof, product mutation runner, browser lifecycle and an independent raw-OOXML export checker are wired in package.json and CI. Only successful assertion failures in deliberate product mutants count as kills. Runtime outputs, browser screenshots, review decisions and release seals belong outside tracked publication source.
