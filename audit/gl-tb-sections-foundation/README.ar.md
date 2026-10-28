# أساس GLT-1: أقسام حسابات متعددة في تشغيل واحد

عقد مقترح، `gl-tb-sections-1`، ومجموعة اصطناعية مختومة قبل أي تشغيل للمنتج عليها. **المنتج لا يدعم هذا العقد،** والعائلتان القائمتان `gl-tb-canonical-1` و`GL_TB_VERTICAL_BALANCES_V1` لم تتغيرا. التقرير: [GLT-1 الأساس](../../docs/audits/GLT-1-FOUNDATION.ar.md).

## الملفات

| الملف | ما فيه |
|---|---|
| [`contract.json`](contract.json) | العقد المقترح: نطاق التشغيل، وقراءة أقسام GL وصفحات TB، وقواعد النص والتاريخ والمبلغ، والرموز، والنتيجة. وقرارات G1 إلى G8 لصاحب المشروع |
| [`stories.py`](stories.py) | تسع وعشرون قصة، ولكل قصة نية مكتوبة باليد قبل أي أوراكل: حالة كل حساب ورموزه، والأقسام والصفحات المستبعدة، والمجاميع اليتيمة، وما لم يوضع تحت حساب، ورموز التشغيل |
| [`render.py`](render.py) و[`render.mjs`](render.mjs) | ثلاثة كتّاب CSV: Python بأقل اقتباس وLF وكل صف بعرض خلاياه، وPython بعلامة ترتيب البايت وCRLF وكل صف ممدود بخلايا فارغة إلى أعرض صف كما تصدّر الجداول، وNode يقتبس كل حقل مع CRLF. ونطاق كل قصة في `<id>-scope.json` |
| [`oracle.py`](oracle.py) | الأوراكل المستقل. يقرأ الملفات ونطاقها والعقد وحدها بوحدة `csv` في Python، ولا يقرأ القصص ولا النية ولا المنتج |
| [`test_oracle.py`](test_oracle.py) | 31 اختبارًا: موافقة كل نية، والعمى عن القصص، وترتيب الأقسام والصفحات والعناوين والأعمدة والصفوف وشكل الكاتب لا يغير حكمًا ولا مكونًا، وحقيقة حاسمة تحرك الحكم، وكل قاعدة لا تمر بها قصة |
| [`mutate_oracle.py`](mutate_oracle.py) | 52 خطأ مزروعًا في نسخة من الأوراكل. يجب أن يفشل كل منها بـassertion |
| [`verify.py`](verify.py) | فحص مستقل لكل ملف بقارئ مكتوب هنا: الخلايا مطابقة للحقائق، وعلامة ترتيب البايت، ونهايات الأسطر، والاقتباس، والمد بالخلايا الفارغة، ونطاق كل قصة. ثم 8 تغييرات مزروعة يجب أن تُرفض |
| [`seal.py`](seal.py) و[`check_seal.py`](check_seal.py) | الختم والتحقق منه |
| `frozen/` | 58 ملف CSV، و29 ملف نطاق، و`stories.json`، و`EXPECTED.json`، و`VERIFY.json`، و`INPUT-MANIFEST.json`، و`SEAL.json` |

## الإعادة

```sh
python3 -B -m unittest discover -s audit/gl-tb-sections-foundation -p test_oracle.py -v
python3 -B audit/gl-tb-sections-foundation/mutate_oracle.py
python3 -B audit/gl-tb-sections-foundation/check_seal.py
```

وإعادة التوليد، قبل الختم فقط:

```sh
python3 -B audit/gl-tb-sections-foundation/stories.py > audit/gl-tb-sections-foundation/frozen/stories.json
python3 -B audit/gl-tb-sections-foundation/render.py audit/gl-tb-sections-foundation/frozen
python3 -B audit/gl-tb-sections-foundation/oracle.py audit/gl-tb-sections-foundation/frozen > audit/gl-tb-sections-foundation/frozen/EXPECTED.json
PYTHONPATH= python3 -B audit/gl-tb-sections-foundation/verify.py audit/gl-tb-sections-foundation/frozen
python3 -B audit/gl-tb-sections-foundation/seal.py
```

`render.py` يحتاج Node. ولا يحتاجه الفحص بعد الختم.

## الحدود

- **كاتب القصص والأوراكل واحد.** الأوراكل مستقل عن المنتج وعن القصص، لا عن فهم كاتبه للعقد. والنية المكتوبة باليد هي ما يقابله.
- **CSV وحده.** لا XLSX ولا PDF، ولا أرصدة موقعة في عمود واحد (GLT-2).
- **ليست holdout.** كتبتُ القصص وأنا أعرف العقد. والدعوى المستقلة تحتاج holdout جديدًا بعد أن يدعم المنتج العقد.
