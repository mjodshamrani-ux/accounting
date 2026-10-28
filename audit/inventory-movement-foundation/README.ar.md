# أساس INV-2: جسور حركة المخزون المقدمة

عقد مقترح، `inventory-movement-bridge-1`، ومجموعة اصطناعية مختومة قبل أي تشغيل للمنتج عليها. **المنتج لا يدعم هذا العقد،** والعائلة القائمة `inventory-posted-register-gl-1` وقراءاتها لم تتغير. التقرير: [INV-2 الأساس](../../docs/audits/INV-2-FOUNDATION.ar.md).

## الملفات

| الملف | ما فيه |
|---|---|
| [`contract.json`](contract.json) | العقد المقترح: نطاق الفترة، وسجل الحركة بأعمدته الاثني عشر وأنواعه العشرة، وملخص GL بحساباته، وقواعد النص والتاريخ والكمية والقيمة، والرموز، والنتيجة. وقرارات I1 إلى I10 لصاحب المشروع |
| [`stories.py`](stories.py) | سبع وأربعون قصة، ولكل قصة نية مكتوبة باليد قبل أي أوراكل: حالة كل مركز (صنف وأبعاده) وكل حساب ورموزهما، والأسطر المستبعدة، والمؤرخة خارج الفترة، والأصول غير الموجودة، والعناوين المكررة، والصفوف التي لم توضع، ورموز التشغيل. ومكونات كل مركز غير موقوف، وجانبا كل حساب مقارن، والمجاميع، من نموذج القصة نفسه |
| [`render.py`](render.py) و[`render.mjs`](render.mjs) | خمسة كتّاب CSV: Python بأقل اقتباس وLF؛ وPython بعلامة ترتيب البايت وCRLF وكل صف ممدود إلى أعرض صف؛ وPython بترميز Windows العربي؛ وNode يقتبس كل حقل مع CRLF؛ وكاتب يصل الخلايا بفواصل بلا اقتباس. لكل قصة ملفان قد يختلف كاتباهما، ونطاقها في `<id>-scope.json` |
| [`oracle.py`](oracle.py) | الأوراكل المستقل. يقرأ الملفين بقارئ RFC 4180 مكتوب هنا، ونطاقهما والعقد. لا يقرأ القصص ولا النية ولا المنتج |
| [`test_oracle.py`](test_oracle.py) | 48 اختبارًا: موافقة كل نية، والعمى عن القصص، وقواعد القراءة، وترتيب الأسطر وأسطر GL والأعمدة واسم الملف والكيان لا يغير شيئًا، وحقيقة حاسمة تحرك الحكم، وكل قاعدة، ومنها خمسة رموز لا تمر بها قصة |
| [`mutate_oracle.py`](mutate_oracle.py) | 108 أخطاء مزروعة في نسخة من الأوراكل. يجب أن يفشل كل منها بـassertion. الجولات الثلاث في `results/` |
| [`verify.py`](verify.py) | فحص مستقل لكل ملف بقارئ آخر مكتوب هنا: الخلايا مطابقة للحقائق، والترميز، وعلامة ترتيب البايت، ونهايات الأسطر، والاقتباس، والمد، ونطاق كل قصة. ثم 11 تغييرًا مزروعًا يجب أن تُرفض |
| [`seal.py`](seal.py) و[`check_seal.py`](check_seal.py) | الختم والتحقق منه |
| [`baseline.mjs`](baseline.mjs) و`results/` | سجل المنتج كما هو، كُتب بعد الختم: السجل وGL كما يصلان، ثم مطويين باليد إلى العائلة القائمة بالختام وحده. التشغيل الأول في `results/baseline-1.json` كما جاء |
| `frozen/` | 47 سجل حركة، و47 ملخص GL، و47 ملف نطاق، و`stories.json`، و`EXPECTED.json`، و`VERIFY.json`، و`INPUT-MANIFEST.json`، و`SEAL.json` |

## الجولات قبل الختم

- **أول مقارنة بين الأوراكل والنيات: 47/47.**
- **اختبارات الأوراكل:** فشلت أول مرة لزلات في الاختبار لا في الأوراكل: مجلد مؤقت يُحذف قبل الحكم، ومفاتيح مراكز التحويل في المساعد، وبادئة معرفات مكررة صنعت تكرارًا لم يُقصد، وGL مساعد يسمي حساب سطر مستبعد، واختبار للعمى يجد اسم `stories.json` في وصف الأوراكل. أُصلحت كلها في الاختبار.
- **الأخطاء المزروعة، الجولة الأولى 105/108** ([`oracle-mutants-1.json`](results/oracle-mutants-1.json)). الثلاثة في أدواتي:
  - `lone-cr-refused`: اختبار القارئ نادى القارئ مباشرة فانتهى برفض لا بـassertion. صار الرفض هناك فشلًا صريحًا.
  - `origin-need-not-read-whole`: أصل المردود في الاختبار كان من صنف آخر أيضًا، فحجزه فحص الصنف. صار أصلًا من الصنف نفسه لا يُقرأ كاملًا لأن فيه معرف تحويل.
  - `position-holds-no-account`: الطفرة تركت `if` بلا جسم فلم تُحمّل أصلًا. صار جسمها `pass`.
- **الجولة الثانية 108/108** ([`oracle-mutants-2.json`](results/oracle-mutants-2.json)). ثم كُتب M45 بكاتب المد ليظهر المد في ملف، فالجولة الثالثة على الملفات المختومة **108/108** ([`oracle-mutants-3.json`](results/oracle-mutants-3.json)).

## الإعادة

```sh
python3 -B -m unittest discover -s audit/inventory-movement-foundation -p test_oracle.py -v
python3 -B audit/inventory-movement-foundation/mutate_oracle.py
python3 -B audit/inventory-movement-foundation/check_seal.py
```

وسجل المنتج:

```sh
node --experimental-strip-types audit/inventory-movement-foundation/baseline.mjs --assert audit/inventory-movement-foundation/results/baseline-1.json
```

وإعادة التوليد، قبل الختم فقط:

```sh
python3 -B audit/inventory-movement-foundation/stories.py > audit/inventory-movement-foundation/frozen/stories.json
python3 -B audit/inventory-movement-foundation/render.py audit/inventory-movement-foundation/frozen
python3 -B audit/inventory-movement-foundation/oracle.py audit/inventory-movement-foundation/frozen > audit/inventory-movement-foundation/frozen/EXPECTED.json
PYTHONPATH= python3 -B audit/inventory-movement-foundation/verify.py audit/inventory-movement-foundation/frozen
python3 -B audit/inventory-movement-foundation/seal.py
```

`render.py` يحتاج Node. ولا يحتاجه الفحص بعد الختم.

## الحدود

- **كاتب القصص والأوراكل واحد.** الأوراكل مستقل عن المنتج وعن القصص، لا عن فهم كاتبه للعقد. والنية المكتوبة باليد هي ما يقابله، والأرقام من نموذج القصة الذي كتبتُه أيضًا.
- **CSV وحده،** ملف حركة واحد وملخص GL واحد لفترة واحدة. لا XLSX ولا PDF، ولا تكلفة ولا تقييم ولا تحويل وحدات، ولا بضاعة في الطريق مركزًا.
- **ليست holdout.** كتبتُ القصص وأنا أعرف العقد. والدعوى المستقلة تحتاج holdout جديدًا بعد أن يدعم المنتج العقد.
