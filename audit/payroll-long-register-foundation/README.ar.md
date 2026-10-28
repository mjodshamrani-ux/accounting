# أساس PAY-1: مسير رواتب طويل بمكونات

عقد مقترح، `payroll-long-register-1`، ومجموعة اصطناعية مختومة قبل أي تشغيل للمنتج عليها. **المنتج لا يدعم هذا العقد،** والعائلة القائمة `payroll-posted-run-gl-bank-1` لم تتغير. التقرير: [PAY-1 الأساس](../../docs/audits/PAY-1-FOUNDATION.ar.md).

## الملفات

| الملف | ما فيه |
|---|---|
| [`contract.json`](contract.json) | العقد المقترح: نطاق التشغيل، وقراءة الأقسام وأسطرها ومجاميعها ومجاميع التشغيل، وقواعد النص والتاريخ والمبلغ، والرموز، والنتيجة. وقرارات P1 إلى P10 لصاحب المشروع |
| [`stories.py`](stories.py) | ثمان وثلاثون قصة، ولكل قصة نية مكتوبة باليد قبل أي أوراكل: حالة كل موظف ورموزه، والأقسام المستبعدة، وحسابات المستفيد المشتركة، والصفوف التي لم توضع تحت موظف، ورموز التشغيل. ومكونات كل موظف غير موقوف ومجاميع التشغيل من نموذج القصة نفسه |
| [`render.py`](render.py) و[`render.mjs`](render.mjs) | خمسة كتّاب CSV: Python بأقل اقتباس وLF؛ وPython بعلامة ترتيب البايت وCRLF وكل صف ممدود إلى أعرض صف؛ وPython بترميز Windows العربي؛ وNode يقتبس كل حقل مع CRLF؛ وكاتب يصل الخلايا بفواصل بلا اقتباس أصلًا. ونطاق كل قصة في `<id>-scope.json` |
| [`oracle.py`](oracle.py) | الأوراكل المستقل. يقرأ الملف بقارئ RFC 4180 مكتوب هنا، ونطاقه والعقد. لا يقرأ القصص ولا النية ولا المنتج |
| [`test_oracle.py`](test_oracle.py) | 39 اختبارًا: موافقة كل نية، والعمى عن القصص، وترتيب الأقسام والعناوين والأعمدة والأسطر والمجاميع وشكل الكاتب لا يغير شيئًا، وحقيقة حاسمة تحرك الحكم، وكل قاعدة لا تمر بها قصة |
| [`mutate_oracle.py`](mutate_oracle.py) | 71 خطأ مزروعًا في نسخة من الأوراكل. يجب أن يفشل كل منها بـassertion. الجولتان في `results/` |
| [`verify.py`](verify.py) | فحص مستقل لكل ملف بقارئ آخر مكتوب هنا: الخلايا مطابقة للحقائق، والترميز، وعلامة ترتيب البايت، ونهايات الأسطر، والاقتباس، والمد، ونطاق كل قصة. ثم 10 تغييرات مزروعة يجب أن تُرفض |
| [`seal.py`](seal.py) و[`check_seal.py`](check_seal.py) | الختم والتحقق منه |
| [`baseline.mjs`](baseline.mjs) و`results/` | سجل المنتج كما هو، كُتب بعد الختم: المسير الطويل في دور المسير، ثم مطويًا باليد بتاريخي القصة، ثم مطويًا وتاريخا القيد والدفع بعد نهاية الفترة. التشغيل الأول في `results/baseline-1.json` كما جاء |
| `frozen/` | 38 ملف CSV، و38 ملف نطاق، و`stories.json`، و`EXPECTED.json`، و`VERIFY.json`، و`INPUT-MANIFEST.json`، و`SEAL.json` |

## الإعادة

```sh
python3 -B -m unittest discover -s audit/payroll-long-register-foundation -p test_oracle.py -v
python3 -B audit/payroll-long-register-foundation/mutate_oracle.py
python3 -B audit/payroll-long-register-foundation/check_seal.py
```

وسجل المنتج:

```sh
node --experimental-strip-types audit/payroll-long-register-foundation/baseline.mjs --assert audit/payroll-long-register-foundation/results/baseline-1.json
```

وإعادة التوليد، قبل الختم فقط:

```sh
python3 -B audit/payroll-long-register-foundation/stories.py > audit/payroll-long-register-foundation/frozen/stories.json
python3 -B audit/payroll-long-register-foundation/render.py audit/payroll-long-register-foundation/frozen
python3 -B audit/payroll-long-register-foundation/oracle.py audit/payroll-long-register-foundation/frozen > audit/payroll-long-register-foundation/frozen/EXPECTED.json
PYTHONPATH= python3 -B audit/payroll-long-register-foundation/verify.py audit/payroll-long-register-foundation/frozen
python3 -B audit/payroll-long-register-foundation/seal.py
```

`render.py` يحتاج Node. ولا يحتاجه الفحص بعد الختم.

## الحدود

- **كاتب القصص والأوراكل واحد.** الأوراكل مستقل عن المنتج وعن القصص، لا عن فهم كاتبه للعقد. والنية المكتوبة باليد هي ما يقابله.
- **CSV وحده.** لا XLSX ولا PDF، ولا أسطر سالبة أو تصحيحات (PAY-3)، ولا دليل صرف (PAY-2).
- **ليست holdout.** كتبتُ القصص وأنا أعرف العقد. والدعوى المستقلة تحتاج holdout جديدًا بعد أن يدعم المنتج العقد.
