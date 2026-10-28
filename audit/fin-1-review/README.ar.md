# مراجعة FIN-1 لأوراكل FIN-1A

أدوات المراجعة، والأوراكل في [`tb-financial-hierarchy`](../tb-financial-hierarchy/) كما هو. التقرير: [FIN-1: المراجعة](../../docs/audits/FIN-1-REVIEW.ar.md).

| الملف | ما فيه |
|---|---|
| [`mutate_oracle.py`](mutate_oracle.py) | 69 خطأً يُزرع كل منها في نسخة من الأوراكل، وتُشغَّل عليها اختبارات FIN-1A، ومع `--h1` نية H1 المختومة، ومع `--review` اختبارات المراجعة. يُعد الخطأ ممسوكًا بـassertion وحده. و`--assert` يفشل إن تغير مصير أي خطأ عما سُجل |
| [`test_review.py`](test_review.py) | ثمانية وعشرون اختبارًا: ستة وعشرون يغير كل منها شيئًا واحدًا في نسخة من القصة الإيجابية ويقول ما يقرره العقد، ومن أي مصدر وأي حقل؛ واختبار للقصة كما هي؛ وآخر يثبت أن خطأ التاريخ الباقي مكافئ. ويُعد توقف الأوراكل فشلًا |
| [`baseline.mjs`](baseline.mjs) | سجل العائلة المسطحة كما هي على حالات FIN-1A وقصص H1: كما تصل، والأوراق باليد، وكل الصفوف باليد. كُتب بعد دفع ختم H1 |
| [`engine-run.mjs`](engine-run.mjs) و[`oracle_codes.py`](oracle_codes.py) | محرك FIN-1 عبر الإعادة من البايتات على حالات FIN-1A، أو على H1 بـ`FINH_SUITE`، مقارنًا بالأوراكل كما هو: الحالة نفسها، والرموز المطلوبة بين رموز المحرك ورموز المحرك بين رموز الأوراكل، وللمؤهلة الحقائق والأبوة. و`oracle_codes.py` يعطي رموز الأوراكل كلها على حالات FIN-1A |
| `results/` | القياسات الثلاثة كما جاءت: اختبارات FIN-1A وحدها 27/69، ومعها نية H1 43/69، ومعها اختبارات المراجعة 68/69. والسجلان `baseline-1.json` و`engine-run-1.json` كما جاءا |

```sh
python3 -B -m unittest discover -s audit/fin-1-review -p test_review.py -v
python3 -B audit/fin-1-review/mutate_oracle.py --h1 --review --assert results/oracle-mutants-3.json
node --experimental-strip-types audit/fin-1-review/baseline.mjs --assert results/baseline-1.json
```
