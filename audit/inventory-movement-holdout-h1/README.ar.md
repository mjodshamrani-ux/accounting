# holdout H1 لـINV-2: جسور حركة المخزون

قصص مختومة قبل أي تشغيل للمنتج عليها، بعقد [أساس INV-2](../inventory-movement-foundation/README.ar.md) المقترح `inventory-movement-bridge-1` كما هو. **كُتبت بعد المحرك، فليست تقييمًا أعمى.**

## ما فيها

- **سلالة قصص لا تستورد شيئًا من الأساس:** موزع أدوية اصطناعي بالدرهم الإماراتي في مايو 2027، وقصة بالدينار البحريني بثلاث منازل. مخازن ودفعات وحساب سلسلة تبريد، وأسماء مخازن عربية وأخرى بمسافات.
- **اثنتان وثلاثون قصة، 142 مركزًا و56 حسابًا،** في 96 ملفًا و9,152 خلية و694 صف حركة.
- **فيها ما لم يحمله الأساس:**
  - تحويل متسلسل من دبي إلى أبوظبي إلى الشارقة، وتحويل بين دفعتين في حساب واحد، وGL يرحّل التحويل نفسه بإجماليه فيتفق الختام ويختلف المدين والدائن؛
  - تحويل أُرسل في أبريل واستُلم في مايو، وتحويل استُلم برمز صنف آخر؛
  - مردود استلام من أبريل موجود في الملف، ومردود عميل بقدر صرفه كله، ومردودان على استلامين، ومردود يزيد بالقيمة وحدها، ومردود يسمي تحويلًا واردًا؛
  - افتتاح سالب (طلبية مؤجلة) بنطاقين، وبقية تقريب بكمية صفر وقيمة سالبة، وإعادة تقييم بلا كمية، وكيلوغرامات بثلاث منازل؛
  - تاريخ 30 فبراير، ووحدة فارغة، ومعرف حركة يشاركه سطر يونيو، ومسافة غير عادية في الأبعاد؛
  - افتتاح رُحّل في حساب آخر، ودائن تبادله حسابان، وGL بأعمدة بترتيب آخر وقيم بمسافات وحساب خامل، وGL عموده الأخير «Balance»، وGL بأرقام عربية هندية؛
  - سجل مقسم صفحات بأعمدة بترتيب آخر، وثمانون مركزًا في خمسة مخازن.
- **الكتّاب خمسة، ولكل ملف كاتبه:** `fputcsv` في PHP 8.3، وكاتب Java 21 بـCRLF، و`encoding/csv` في Go 1.24 بـUseCRLF، وكاتب Perl 5.38 بعلامة ترتيب البايت ونهايات CR وحدها، وتصدير LibreOffice Calc 24.2 من ODS مسطح.

## الملفات

| الملف | ما فيه |
|---|---|
| [`stories.py`](stories.py) | القصص والنية المكتوبة باليد: حالة كل مركز وحساب ورموزهما والقوائم. والأرقام من نموذج القصة |
| [`render.py`](render.py) و[`render.php`](render.php) و[`Render.java`](Render.java) و[`render.go`](render.go) و[`render.pl`](render.pl) | الكتّاب الخمسة |
| [`judge.py`](judge.py) | `EXPECTED.json` من أوراكل الأساس المختوم كما هو، بلا تغيير ولا غلاف |
| [`test_intent.py`](test_intent.py) | الأوراكل يوافق كل نية، و`EXPECTED.json` هو ما يعيده |
| [`verify.py`](verify.py) | فحص مستقل لكل ملف بقارئ آخر: الخلايا، وشكل كل كاتب، والنطاق. و11 تغييرًا مزروعًا تُرفض كلها |
| [`eligibility.py`](eligibility.py) | ما يزيده المنتج على العقد من حدود، على الملفين في كل قصة دون تشغيل المنتج: لا ملف خارجها |
| [`seal.py`](seal.py) و[`check_seal.py`](check_seal.py) | الختم والتحقق منه، ومعهما أوراكل الأساس وعقده |
| `frozen/` | 32 سجل حركة، و32 ملخص GL، و32 ملف نطاق، و`stories.json`، و`EXPECTED.json`، و`VERIFY.json`، و`ELIGIBILITY.json`، و`INPUT-MANIFEST.json`، و`SEAL.json` |

## قبل الختم

- **وافق أوراكل الأساس كما هو النية المكتوبة باليد في 31 قصة من 32 في أول مقارنة.** الثانية والثلاثون H22: سطران يتشاركان معرف حركة، والنية أخذت صف أولهما، استلام مايو، والمستبعد سطر يونيو. **الزلة في ربط النية بالصفوف لا في الأوراكل،** فصُحح الربط وصار 32/32، والملفات كما هي.
- **وقبلها، في نموذج القصص:** سطر بتاريخ 30 فبراير حسبه النموذج مؤرخًا خارج الفترة، والعقد لا يسرد إلا السطر الذي يُقرأ كاملًا. فصار النموذج يعرف السطر الذي لا يُقرأ كاملًا.

## الإعادة

```sh
python3 -B -m unittest discover -s audit/inventory-movement-holdout-h1 -p test_intent.py -v
python3 -B audit/inventory-movement-holdout-h1/check_seal.py
```

وإعادة التوليد، قبل الختم فقط، تحتاج PHP وJava وGo وPerl وLibreOffice:

```sh
python3 -B audit/inventory-movement-holdout-h1/stories.py > audit/inventory-movement-holdout-h1/frozen/stories.json
python3 -B audit/inventory-movement-holdout-h1/render.py audit/inventory-movement-holdout-h1/frozen
python3 -B audit/inventory-movement-holdout-h1/judge.py audit/inventory-movement-holdout-h1/frozen > audit/inventory-movement-holdout-h1/frozen/EXPECTED.json
PYTHONPATH= python3 -B audit/inventory-movement-holdout-h1/verify.py audit/inventory-movement-holdout-h1/frozen
PYTHONPATH= python3 -B audit/inventory-movement-holdout-h1/eligibility.py audit/inventory-movement-holdout-h1/frozen
python3 -B audit/inventory-movement-holdout-h1/seal.py
```

## الحدود

- **ليست تقييمًا أعمى:** كتبتُ العقد والأوراكل والمحرك قبلها. وهي مستقلة عن قصص الأساس وكتّابه.
- **CSV وحده،** ومصطنعة.
