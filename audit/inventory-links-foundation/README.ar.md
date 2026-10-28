# أساس INV-3: روابط سجل المخزون وأسبابها، وكثافته

قصص مختومة قبل أي تشغيل للمنتج عليها، بعقد مقترح [`contract.json`](contract.json): `inventory-register-links-1`، دليل يضاف إلى العائلة القائمة `inventory-posted-register-gl-1` ولا يغير قرارًا من قراراتها. [التقرير](../../docs/audits/INV-3-FOUNDATION.ar.md).

## ما فيها

- **26 قصة مركزة، L01 إلى L26،** كل منها أربعة ملفات CSV: السجل والخريطة ودليل السياسة وGL، ونطاق من اثني عشر حقلًا. 361 صف سجل، منها 22 غير مربوط، و6 صفوف أخرى غير مربوطة.
  - كل سبب في العقد وحده، وثلاثة معًا، وكلها في ملف واحد؛
  - و00420 و420، وWarehouse وwarehouse، وأكواد تشبه الأرقام والتواريخ، وأبعاد عربية ومسافات، واثنا عشر جزءًا للأبعاد وأعمدة بترتيب آخر؛
  - وصف لا يُقرأ في السجل وفي الخريطة، وصفا سجل لصنف وأبعاد واحدة؛
  - والمنافس في آخر صف من خريطة بثلاثمئة صنف؛
  - وريال ودينار كويتي بثلاث منازل وين بلا منازل.
- **خمس قصص كثيفة، D1 إلى D5،** تُولد بقواعد ثابتة بلا عشوائية، ولا تُخزن: تُختم ببصمة كل ملف وبصمة توقعها، ويعيد [`dense.py`](dense.py) توليدها ويتحقق منها قبل أي تشغيل.
  - D1 ألف صنف مربوطة كلها؛
  - وD2 خمسة آلاف صنف بأبعاد من اثني عشر جزءًا وأصفار بادئة، و298 صفًا غير مربوط بلا خطأ مصدر؛
  - **وD3 على سقف العائلة تمامًا:** 6,658 صنفًا و26 حساب GL، 20,000 صف بيانات، مربوطة كلها؛
  - **وD4 بعده بصف واحد،** فتُرفض كما اليوم؛
  - وD5 ستة آلاف صنف بكل سبب، وصف GL لا يربطه صنف، وحساب بلا صف GL.
- **الكتّاب:** Python بأقل اقتباس وLF أو CRLF؛ وPython يقتبس كل حقل مع علامة ترتيب البايت وCRLF؛ وNode يقتبس ما فيه غير الحروف اللاتينية والأرقام والنقطة والشرطة؛ وكاتب يصل الخلايا بفواصل بلا اقتباس. والقصص الكثيفة بكتّاب Python وحدهم، ليعيد CI توليدها.

## الملفات

| الملف | ما فيه |
|---|---|
| [`stories.py`](stories.py) | القصص والنية المكتوبة باليد: حالة كل صف سجل وأسبابه، والصفوف الأخرى غير المربوطة، والحكم المالي |
| [`render.py`](render.py) و[`render.mjs`](render.mjs) | الكتّاب |
| [`oracle.py`](oracle.py) | الروابط من سجلات [الأوراكل المرجعي القائم](../inventory-register/reference.py) كما هو، بفهارس مستقلة، ويتوقف إن خالفت مفاتيحه الناقصة |
| [`test_oracle.py`](test_oracle.py) و[`mutate_oracle.py`](mutate_oracle.py) | 23 اختبارًا، و20 خطأً مزروعًا في نسخة الأوراكل |
| [`verify.py`](verify.py) | فحص مستقل لكل ملف بقارئ CSV مكتوب هنا: الخلايا، وشكل كل كاتب، والنطاق؛ وثمانية تغييرات مزروعة تُرفض |
| [`dense.py`](dense.py) | يعيد توليد القصص الكثيفة ويتحقق من بصماتها |
| [`seal.py`](seal.py) و[`check_seal.py`](check_seal.py) | الختم والتحقق منه |
| `frozen/` | ملفات القصص المركزة، و`stories.json`، و`EXPECTED.json`، و`VERIFY.json`، و`DENSE-MANIFEST.json`، و`INPUT-MANIFEST.json`، و`SEAL.json` |

## قبل الختم

- **وافق الأوراكل النية المكتوبة باليد في القصص كلها من أول مقارنة،** 26/26 مركزة و5/5 كثيفة.
- **وزلتان في نموذج القصص قبل المقارنة:** قصة يسمّي فيها الصنف دليل جاره كانت تختلف بمرجع التقييم أيضًا ولم تذكره النية، فوُحّد المرجع لتبقى القصة لسببيها؛ وصف لا يُقرأ يُكتب في آخر الملف لا في وسطه، فصُحح رقم صف جاره.
- **وزلتان في الأدوات:** `stories.json` حمل القصص الكثيفة فبلغ 24 ميغابايت، فصار للمركزة وحدها؛ وتغيير مزروع حذف اقتباسًا من ملف لا يقتبس كاتبه، فلم يتغير شيء، فوُجّه إلى ملف يقتبس كل حقل.
- **الأخطاء المزروعة:** الجولة الأولى 0/20، كلها توقفت لأن شجرة الطفرات لم تنسخ الأوراكل المرجعي، ولم يكن في المشغّل تشغيل أساس بلا طفرة يكشف ذلك ([`oracle-mutants-1.json`](results/oracle-mutants-1.json)). فصار ينسخه ويطلب أساسًا ناجحًا: **الثانية 20/20** ([`oracle-mutants-2.json`](results/oracle-mutants-2.json)).

## الإعادة

```sh
python3 -B -m unittest discover -s audit/inventory-links-foundation -p test_oracle.py -v
python3 -B audit/inventory-links-foundation/mutate_oracle.py
python3 -B audit/inventory-links-foundation/check_seal.py
```

وإعادة التوليد، قبل الختم فقط، تحتاج Node:

```sh
python3 -B audit/inventory-links-foundation/stories.py > audit/inventory-links-foundation/frozen/stories.json
python3 -B audit/inventory-links-foundation/render.py audit/inventory-links-foundation/frozen
python3 -B audit/inventory-links-foundation/oracle.py audit/inventory-links-foundation/frozen > audit/inventory-links-foundation/frozen/EXPECTED.json
python3 -B audit/inventory-links-foundation/verify.py audit/inventory-links-foundation/frozen
python3 -B audit/inventory-links-foundation/seal.py
```

## الحدود

- **كتبتُ العقد والقصص والأوراكل،** وسأكتب المنتج. والأوراكل مستقل عن المنتج في شفرته ولغته، ويعتمد الأوراكل المرجعي القائم في القراءة والحكم المالي.
- **CSV وحده،** ومصطنعة. وXLSX وقراءات العائلة الأخرى لـholdout لاحق.
