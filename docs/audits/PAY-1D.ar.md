# PAY-1d: التشغيل الأول لـholdout H1 للمسير الطويل

التاريخ: 28 أكتوبر 2026. بعد [PAY-1c](PAY-1C.ar.md). المرشح ما زال 0.4.58 غير منشور.

[الحزمة](../../audit/payroll-long-register-holdout-h1/README.ar.md) اثنتان وثلاثون قصة من PHP وJava وGo وPerl وLibreOffice. **خُتمت ودُفعت (`4406df4`) قبل أي تشغيل للمنتج عليها.** وتوقعها من أوراكل الأساس المختوم كما هو.

## التشغيل الأول على المحرك، كما جاء

[`engine-run-1.json`](../../audit/payroll-long-register-holdout-h1/results/engine-run-1.json): **32/32 مساوية لـ`EXPECTED.json` كاملًا،** دون تغيير في المنتج.

**القاعدة كاملة،** كما على الأساس:

- الرفض، أو حالة كل موظف ورموزه؛
- ولكل موظف غير موقوف مكوناته وأسطره وحساب مستفيده؛
- والصفحات المستبعدة، وحسابات المستفيد المشتركة، والصفوف المسرودة، والمجاميع، ورموز التشغيل.

## التشغيل الأول في المتصفح

[القبول](../../scripts/payroll-long-register-browser.mjs) بالتطبيق المبني والعامل الفعلي: **32/32 على الشاشة،** بلا خطأ صفحة ولا طلب خارجها، [`browser-run-1.json`](../../audit/payroll-long-register-holdout-h1/results/browser-run-1.json).

- يقارن ما تعرضه الصفحة بـ`EXPECTED.json` كما في [PAY-1c](PAY-1C.ar.md).
- وينتقل بين صفحات الجداول حتى آخرها، فالقصة ذات الموظفين المئتين والأربعين تُقرأ كلها.

## ما يقوله وما لا يقوله

- **يقول:** المحرك والقسم يعطيان، على 32 قصة لم يرها المنتج قبل ختمها، ما يحكم به أوراكل الأساس كما هو. القصص من خمسة كتّاب لم يكتب بها الأساس، ومنها:
  - CR وحدها مع علامة ترتيب البايت؛
  - وسطر جديد داخل حقل يكتبه Go CRLF؛
  - ودينار بحريني وريال عماني بثلاث منازل وأرقام فارسية؛
  - وعملة صفحة بحروف صغيرة؛
  - ومجاميع تشغيل قبل الصفحات.
- **لا يقول:**
  - إن العقد صحيح محاسبيًا؛ فالقرارات P1 إلى P10 لصاحب المشروع.
  - ولا إن المحرك يقرأ مسيرات أنظمة رواتب حقيقية، أو XLSX أو PDF.
- **كتبتُ العقد والقصص والمحرك،** وكتبتُ H1 بعد المحرك. قصص H1 لم يرها المنتج قبل ختمها، لكنها ليست تقييمًا أعمى ولا ميدانيًا.

## الإعادة

```sh
python3 -B audit/payroll-long-register-holdout-h1/check_seal.py
PLR_SUITE=audit/payroll-long-register-holdout-h1 node --experimental-strip-types audit/payroll-long-register-foundation/engine-run.mjs --assert engine-run-1.json
pnpm build && PLR_SUITE=audit/payroll-long-register-holdout-h1 node scripts/payroll-long-register-browser.mjs --assert=browser-run-1.json
```

## التالي

**PAY-1 منفذ على قصص مصطنعة،** وينتظر قرارات P1 إلى P10 والدمج. والتالي بترتيب «بقية المجالات» المكتوب: INV-2.
