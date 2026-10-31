# أساس IC-1: عدة شركات في تشغيل واحد

عقد مقترح، `intercompany-batch-1`، ومجموعة اصطناعية مختومة قبل أي تشغيل للمنتج عليها. **المنتج لا يدعم هذا العقد،** والعائلة القائمة `intercompany-ledger-1` لم تتغير. التقرير: [IC-1 الأساس](../../docs/audits/IC-1-FOUNDATION.ar.md).

## الملفات

| الملف | ما فيه |
|---|---|
| [`contract.json`](contract.json) | العقد المقترح: المدخلات، قواعد القراءة، التصريح بالدفعات، الإسناد، العلاقات، الرموز، والنتيجة. وقرارات B1 إلى B8 لصاحب المشروع |
| [`stories.py`](stories.py) | عشرون قصة، ولكل قصة نية مكتوبة باليد قبل أي أوراكل: حالة كل دفعة ورموزها، وفرق كل علاقة، وعدد الصفوف غير المسندة |
| [`render.py`](render.py) و[`render.mjs`](render.mjs) و[`render.rb`](render.rb) | أربعة كتّاب CSV: Python بأقل اقتباس وLF، وPython بعلامة ترتيب البايت وCRLF، وNode يقتبس كل حقل مع CRLF، وRuby CSV مع LF |
| [`oracle.py`](oracle.py) | الأوراكل المستقل. يقرأ الملفات والعقد وحدهما بوحدة `csv` في Python، ولا يقرأ القصص ولا النية ولا المنتج |
| [`test_oracle.py`](test_oracle.py) | 21 اختبارًا: موافقة كل نية، والعمى عن القصص، وترتيب الصفوف والأعمدة لا يغير حكمًا ولا عضوًا، وحقيقة حاسمة تحرك الحكم، وكل قاعدة لا تمر بها قصة |
| [`mutate_oracle.py`](mutate_oracle.py) | 32 خطأ مزروعًا في نسخة من الأوراكل. يجب أن يفشل كل منها بـassertion |
| [`verify.py`](verify.py) | فحص مستقل لكل ملف بقارئ مكتوب هنا: الخلايا مطابقة للحقائق، وعلامة ترتيب البايت، ونهايات الأسطر، والاقتباس كما يكتبه كاتبه. ثم 7 تغييرات مزروعة يجب أن تُرفض |
| [`seal.py`](seal.py) و[`check_seal.py`](check_seal.py) | الختم والتحقق منه |
| [`baseline.mjs`](baseline.mjs) و`results/` | سجل المنتج كما هو، كُتب بعد الختم: ملفات القصة في أدوار المنتج الأربعة، ثم مقسومة باليد دفعة دفعة. التشغيل الأول في `results/baseline-1.json` كما جاء |
| `frozen/` | 95 ملف CSV، و`stories.json`، و`EXPECTED.json`، و`VERIFY.json`، و`INPUT-MANIFEST.json`، و`SEAL.json` |

## الإعادة

```sh
python3 -B -m unittest discover -s audit/intercompany-batch-foundation -p test_oracle.py -v
python3 -B audit/intercompany-batch-foundation/mutate_oracle.py
python3 -B audit/intercompany-batch-foundation/check_seal.py
```

وإعادة التوليد، قبل الختم فقط:

```sh
python3 -B audit/intercompany-batch-foundation/stories.py > audit/intercompany-batch-foundation/frozen/stories.json
python3 -B audit/intercompany-batch-foundation/render.py audit/intercompany-batch-foundation/frozen
python3 -B audit/intercompany-batch-foundation/oracle.py audit/intercompany-batch-foundation/frozen > audit/intercompany-batch-foundation/frozen/EXPECTED.json
python3 -B audit/intercompany-batch-foundation/verify.py audit/intercompany-batch-foundation/frozen
python3 -B audit/intercompany-batch-foundation/seal.py
```

وسجل المنتج:

```sh
node --experimental-strip-types audit/intercompany-batch-foundation/baseline.mjs --assert audit/intercompany-batch-foundation/results/baseline-1.json
```

`render.py` يحتاج Node وRuby 3.3. ولا يحتاجهما الفحص بعد الختم.

## الحدود

- **كاتب القصص والأوراكل واحد.** الأوراكل مستقل عن المنتج وعن القصص، لا عن فهم كاتبه للعقد. والنية المكتوبة باليد هي ما يقابله.
- **CSV وحده.** دليل XLSX في العائلة القائمة يقبل نمط مصنف واحدًا لم يُعَد اشتقاقه هنا قبل الختم.
- **ليست holdout.** كتبتُ القصص وأنا أعرف العقد. والدعوى المستقلة تحتاج holdout جديدًا بعد أن يدعم المنتج العقد.
