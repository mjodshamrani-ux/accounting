# holdout H1 لـINV-3: روابط سجل المخزون

قصص مختومة قبل أي تشغيل للمنتج عليها، بعقد [أساس INV-3](../inventory-links-foundation/README.ar.md) المقترح `inventory-register-links-1` كما هو. **كُتبت بعد المحرك والشاشة، فليست تقييمًا أعمى.**

## ما فيها

- **سلالة قصص لا تستورد شيئًا من الأساس:** موزع قطع غيار بحرية اصطناعي في يونيو 2027، بالريال، وقصة بالدينار الكويتي بثلاث منازل، وقصة بالين بلا منازل. موانئ ورفوف وحاويات، واسم منشأة عربي، ورموز أصناف عربية.
- **إحدى وعشرون قصة،** في 84 ملفًا و79,576 خلية و3,722 صف بيانات: **1,246 صف سجل، منها 67 لا تُربط،** و8 صفوف أخرى لا يربطها شيء.
- **كل سبب في العقد، وكل نوع من الصفوف الأخرى:**
  - `12.0` ليس `12`، و`0071` بجانب `071`، و`PUMP-07` بدليل يسمي `PUMP-7`؛
  - خريطتان تسميان حسابين، ودليل مكرر بعينه، ودليل منتهٍ في 2026 فلا دليل؛
  - `kg` ليست `KG`، والدقة والتقييم معًا، و`branch=1` ليست `branch=01`، و`bay=02` ليست `bay=2`، ودليل يسمي 14200 والخريطة 14100؛
  - **صف تختلف فيه الحقول السبعة كلها،** فتُذكر بترتيب العقد؛
  - خريطة بلا سجل، ودليل لا تسميه خريطة، وأستاذ بحساب لا يربطه صف، وحساب مربوط بلا أستاذ، **وأستاذ يكتب `port=dmm` والخريطة `port=DMM`،** وحساب في الأستاذ لا يسميه إلا صف غير مربوط؛
  - أبعاد فيها فواصل وعلامات تنصيص، وكل عمود بترتيب معكوس، وصنف واحد في خمسة رفوف، و1,200 صنف بالدينار الكويتي واحد من كل خمسة وعشرين لا يُربط.
- **الكتّاب خمسة، ولكل ملف كاتبه:** `fputcsv` في PHP 8.3، وكاتب Java 21 بـCRLF، و`encoding/csv` في Go 1.24 بـUseCRLF، وكاتب Perl 5.38 بعلامة ترتيب البايت ونهايات CR وحدها، وتصدير LibreOffice Calc 24.2 من ODS مسطح.

## الملفات

| الملف | ما فيه |
|---|---|
| [`stories.py`](stories.py) | القصص والنية المكتوبة باليد: كل صف سجل مربوط أو غير مربوط بأسبابه، وكل صف آخر، والحكم المالي |
| [`render.py`](render.py) و[`render.php`](render.php) و[`Render.java`](Render.java) و[`render.go`](render.go) و[`render.pl`](render.pl) | الكتّاب الخمسة، منسوخون من holdout INV-2 |
| [`judge.py`](judge.py) | `EXPECTED.json` من أوراكل الأساس المختوم كما هو، بلا تغيير ولا غلاف |
| [`test_intent.py`](test_intent.py) | الأوراكل يوافق كل نية، و`EXPECTED.json` هو ما يعيده |
| [`verify.py`](verify.py) | فحص مستقل لكل ملف بقارئ آخر: الخلايا، وشكل كل كاتب، والنطاق. و13 تغييرًا مزروعًا تُرفض كلها |
| [`eligibility.py`](eligibility.py) | ما يزيده المنتج على العقد من حدود، على الملفات الأربعة في كل قصة دون تشغيل المنتج: لا ملف خارجها |
| [`seal.py`](seal.py) و[`check_seal.py`](check_seal.py) | الختم والتحقق منه، ومعهما أوراكل الأساس وعقده والمرجع الذي يستورده |
| `frozen/` | أربعة ملفات CSV وملف نطاق لكل قصة، و`stories.json`، و`EXPECTED.json`، و`VERIFY.json`، و`ELIGIBILITY.json`، و`INPUT-MANIFEST.json`، و`SEAL.json` |

## قبل الختم

- **وافق أوراكل الأساس كما هو النية المكتوبة باليد في 16 قصة من 16 في أول مقارنة.** ثم أُضيفت خمس قصص لأسباب لم تحملها الست عشرة: `EVIDENCE_ACCOUNT` و`EVIDENCE_DIMENSIONS` والحقول السبعة معًا، وأستاذ بأبعاد أخرى، وحساب في الأستاذ لا يسميه إلا صف غير مربوط. ووافق الخمس كذلك في أول مقارنة.
- **فحص النية يفشل حين تتغير:** سبب حُذف من نية K19 في نسخة فرفضها.
- **أول فحص مستقل شُغل على مجلد مؤقت فيه ملفات holdout آخر،** فرفضه لأن فيه ملفات لا تسميها قصة، كما ينبغي. وأُعيد على مجلد نظيف.
- **علامة ترتيب بايت حرفية في `eligibility.py`** صارت `\ufeff` قبل الختم (DEV-79).

## الإعادة

```sh
python3 -B -m unittest discover -s audit/inventory-links-holdout-h1 -p test_intent.py -v
python3 -B audit/inventory-links-holdout-h1/check_seal.py
```

وإعادة التوليد، قبل الختم فقط، تحتاج PHP وJava وGo وPerl وLibreOffice:

```sh
python3 -B audit/inventory-links-holdout-h1/stories.py > audit/inventory-links-holdout-h1/frozen/stories.json
python3 -B audit/inventory-links-holdout-h1/render.py audit/inventory-links-holdout-h1/frozen
python3 -B audit/inventory-links-holdout-h1/judge.py audit/inventory-links-holdout-h1/frozen > audit/inventory-links-holdout-h1/frozen/EXPECTED.json
PYTHONPATH= python3 -B audit/inventory-links-holdout-h1/verify.py audit/inventory-links-holdout-h1/frozen
PYTHONPATH= python3 -B audit/inventory-links-holdout-h1/eligibility.py audit/inventory-links-holdout-h1/frozen
python3 -B audit/inventory-links-holdout-h1/seal.py
```

## الحدود

- **ليست تقييمًا أعمى:** كتبتُ العقد والأوراكل والمحرك والشاشة قبلها. وهي مستقلة عن قصص الأساس وكتّابه.
- **CSV وحده،** ومصطنعة.
- **النية تقارن الحالة والأسباب والصفوف الأخرى والحكم،** وصفوف الخريطة والدليل والأستاذ في كل رابط يقارنها `EXPECTED.json` من الأوراكل.
