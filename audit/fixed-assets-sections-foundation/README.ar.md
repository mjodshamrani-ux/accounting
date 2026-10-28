# أساس FA-1: سجل أصول بأقسام المواقع والفئات

عقد مقترح، `fixed-assets-sections-1`، ومجموعة اصطناعية مختومة قبل أي تشغيل للمنتج عليها. **المنتج لا يدعم هذا العقد،** والعائلتان القائمتان `fixed-assets-posted-components-gl-1` و`fixed-assets-long-components-gl-1` لم تتغيرا. التقرير: [FA-1 الأساس](../../docs/audits/FA-1-FOUNDATION.ar.md).

## الملفات

| الملف | ما فيه |
|---|---|
| [`contract.json`](contract.json) | العقد المقترح: نطاق التشغيل، والسجل بأقسامه وعناوينها وأعمدتها ومجاميعها، وخريطة الفئات بصلاحيتها، وأرصدة GL، وقواعد النص والتاريخ والمبلغ، والرموز وترتيبها، والنتيجة. وقرارات F1 إلى F10 لصاحب المشروع |
| [`stories.py`](stories.py) | ثمان وأربعون قصة مركزة وقصتان كثيفتان، ولكل قصة نية مكتوبة باليد: حالة كل قسم، وكل أصل محجوز برموزه، وكل حساب بحالته ورموزه وأعضائه، والأزواج التي لا تضعها الخريطة، والصفوف التي لا توضع، ورموز التشغيل، أو رفض القصة |
| [`render.py`](render.py) و[`render.mjs`](render.mjs) | سبعة أشكال كتابة: Python بأقل اقتباس مع LF أو CRLF أو CR وحده، وكل حقل مقتبس مع علامة ترتيب البايت وCRLF، وعلامتا ترتيب قبل السجل، وكل صف ممدود بخلايا فارغة إلى أعرض صف كما تصدّر الجداول، وNode يقتبس كل حقل مع CRLF. ورقعة بايتات لقصة لا يكتبها كاتب |
| [`oracle.py`](oracle.py) | الأوراكل المستقل. يقرأ الملفات الثلاثة ومدخلها بمحلل فاصلة مكتوب هنا، ولا يستورد القصص ولا النية ولا المنتج |
| [`test_oracle.py`](test_oracle.py) | 62 اختبارًا: موافقة كل نية، والعمى عن القصص، وترتيب العناوين والأعمدة والأقسام والصفوف وشكل الكاتب لا يغير حكمًا، وكل قاعدة قراءة وكل رمز وكل سقف |
| [`mutate_oracle.py`](mutate_oracle.py) | 65 خطأً مزروعًا في نسخة من الأوراكل. يجب أن يفشل كل منها بـassertion |
| [`verify.py`](verify.py) | فحص مستقل لكل ملف بوحدة `csv` في Python لا بمحلل الأوراكل: الخلايا مطابقة للحقائق، وعلامات ترتيب البايت، ونهايات الأسطر، والاقتباس، والمد، والرقعة، والمدخلات. ثم 12 تغييرًا مزروعًا يجب أن تُرفض |
| [`dense.py`](dense.py) و[`seal.py`](seal.py) و[`check_seal.py`](check_seal.py) | إعادة توليد الكثيفتين والتحقق منهما، والختم والتحقق منه |
| `frozen/` | 144 ملف CSV و48 ملف مدخلات، و`stories.json` و`EXPECTED.json` و`VERIFY.json` و`DENSE-MANIFEST.json` و`INPUT-MANIFEST.json` و`SEAL.json` |
| [`engine-run.mjs`](engine-run.mjs) | المحرك `fixed-assets-sections-1` على القصص المختومة عبر الإعادة من البايتات، مقارنًا بـ`EXPECTED.json` كاملًا. التشغيل الأول في `results/engine-run-1.json` كما جاء ([FA-1b](../../docs/audits/FA-1B.ar.md)) |
| [`baseline.mjs`](baseline.mjs) و`results/` | سجل المنتج كما هو، كُتب بعد الختم: القصة كما تصل في أدوار العائلة الطويلة، ثم مقطوعة باليد إلى ملفاتها الأربعة. التشغيل الأول في `results/baseline-1.json` كما جاء. وسجلا الأخطاء المزروعة في الأوراكل كما جاءا |

## قبل الختم

- **وافق الأوراكل النية المكتوبة باليد في 45 قصة من 48 في أول مقارنة.** والثلاث:
  - **قصتان على رمز زائد:** كان نص العقد يعطي `REGISTER_ABSENT` أيضًا لحساب لا تسميه خريطة، فيكتب `UNMAPPED` و`REGISTER_ABSENT` معًا، والنية `UNMAPPED` وحده. **صار العقد يقصر `REGISTER_ABSENT` على حساب تسميه خريطة ولا عضو له،** وتغير الأوراكل معه.
  - **وقصة على خطأ في كاتبي:** كاتب علامتي الترتيب وضعهما قبل الملفات الثلاثة، فرُفضت الخريطة `COLUMNS`، والقصة عن السجل وحده. صار الكاتب يضعهما قبل السجل وحده.
  - ثم 48/48، والكثيفتان من أول مقارنة.
- **الأخطاء المزروعة في الأوراكل،** [`oracle-mutants-1.json`](results/oracle-mutants-1.json): 58/65. اثنان منها لم يُطبقا، لأن بديلهما ترك كتلة فارغة فلم يُقرأ الملف، فصُححا. وخمسة أمسكتها assertion لكن انهار اختبار آخر معها، لأن الأوراكل المطفّر انهار أو رُفض حيث لم يتوقع الاختبار. **فصار أي استثناء من الأوراكل غير الرفض فشلًا بـassertion،** وصار الرفض غير المتوقع فشلًا كذلك، لأن إعادة نتيجة لكل مدخل شرط. ثم [`oracle-mutants-2.json`](results/oracle-mutants-2.json): **65/65.**
- **وفي اختبار المجاميع خطأ مني لا من الأوراكل:** توقعتُ أن مبلغًا لا يُقرأ في صف تكلفة يمنع فحص مجموع الاستهلاك، والعقد يقول إنه يمنع فحص مجموع مكونه وحده؛ فصُحح الاختبار، وبقي الأوراكل.
- **محارف حرفية:** كتبت أداة الكتابة الهروب `\u` محارف حرفية في `stories.py` و`oracle.py` و`test_oracle.py` و`verify.py`، فصارت مهربة قبل التوليد (DEV-79).

## الإعادة

```sh
python3 -B -m unittest discover -s audit/fixed-assets-sections-foundation -p test_oracle.py -v
python3 -B audit/fixed-assets-sections-foundation/mutate_oracle.py
python3 -B audit/fixed-assets-sections-foundation/check_seal.py
```

وسجل المنتج:

```sh
node --experimental-strip-types audit/fixed-assets-sections-foundation/baseline.mjs --assert baseline-1.json
```

وإعادة التوليد، قبل الختم فقط:

```sh
python3 -B audit/fixed-assets-sections-foundation/stories.py > audit/fixed-assets-sections-foundation/frozen/stories.json
python3 -B audit/fixed-assets-sections-foundation/render.py audit/fixed-assets-sections-foundation/frozen
python3 -B audit/fixed-assets-sections-foundation/oracle.py audit/fixed-assets-sections-foundation/frozen > audit/fixed-assets-sections-foundation/frozen/EXPECTED.json
PYTHONPATH= python3 -B audit/fixed-assets-sections-foundation/verify.py audit/fixed-assets-sections-foundation/frozen
python3 -B audit/fixed-assets-sections-foundation/seal.py
```

`render.py` يحتاج Node للقصص المركزة. ولا يحتاجه الفحص بعد الختم.

## الحدود

- **كاتب القصص والأوراكل واحد.** الأوراكل مستقل عن المنتج وعن القصص، لا عن فهم كاتبه للعقد. والنية المكتوبة باليد هي ما يقابله.
- **CSV وحده،** كما في العائلة الطويلة. لا XLSX ولا PDF، ولا رؤوس صفحات مطبوعة.
- **ليست holdout.** كتبتُ القصص وأنا أعرف العقد. والدعوى المستقلة تحتاج holdout جديدًا بعد أن يدعم المنتج العقد.
