# مراجعة FIN-1 لأوراكل FIN-1A

أدوات المراجعة، والأوراكل في [`tb-financial-hierarchy`](../tb-financial-hierarchy/) كما هو. التقرير: [FIN-1: المراجعة](../../docs/audits/FIN-1-REVIEW.ar.md).

| الملف | ما فيه |
|---|---|
| [`mutate_oracle.py`](mutate_oracle.py) | 69 خطأً يُزرع كل منها في نسخة من الأوراكل، وتُشغَّل عليها اختبارات FIN-1A، ومع `--h1` نية H1 المختومة، ومع `--review` اختبارات المراجعة. يُعد الخطأ ممسوكًا بـassertion وحده. و`--assert` يفشل إن تغير مصير أي خطأ عما سُجل |
| [`test_review.py`](test_review.py) | ثمانية وعشرون اختبارًا: ستة وعشرون يغير كل منها شيئًا واحدًا في نسخة من القصة الإيجابية ويقول ما يقرره العقد، ومن أي مصدر وأي حقل؛ واختبار للقصة كما هي؛ وآخر يثبت أن خطأ التاريخ الباقي مكافئ. ويُعد توقف الأوراكل فشلًا |
| `results/` | القياسات الثلاثة كما جاءت: اختبارات FIN-1A وحدها 27/69، ومعها نية H1 43/69، ومعها اختبارات المراجعة 68/69 |

```sh
python3 -B -m unittest discover -s audit/fin-1-review -p test_review.py -v
python3 -B audit/fin-1-review/mutate_oracle.py --h1 --review --assert results/oracle-mutants-3.json
```
