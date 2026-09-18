# جولة قبول تراصف 0.4.7

على `integration/0.4.7-unified`، ابتداءً من `d1862c0` الذي روجع. لا دمج في `main` ولا نشر. لم يُعَد بناء المحرك ولم يتوسع نطاق المنتج؛ التعديلات محصورة فيما أثبتت الجولة الحاجة إليه.

أرقام 0.4.7 هي خط الأساس، وقد أُعيد إنتاجها من نسخة نظيفة بعد التعديلات (القسم 3) وبقيت كما هي.

## 1. اختبار حسم الالتباس صار شرط قبول، لا ملاحظة

**ما كان قائمًا:** `ambiguityGate` يُسجَّل ويُعرض ولا يقرر شيئًا. والأسوأ أن المسبار كان يعتبر **أي** `throw` حمايةً ناجحة، فخطأ برمجي مثل `TypeError` كان يُحتسب «الحارس يعمل».

**ما تغيّر:**

- `assertInputFormats` صار يرفض برفض معلن من نوعه: `InputReadinessError` يحمل رمزًا (`FORMAT_INVALID` أو `FORMAT_AMBIGUOUS_UNRESOLVED`) والحقل والتفسيرات التي سمح بها المستند.
- العامل يمرر هذه الحقائق مع الرسالة، كما يمرر تشخيص الاستيراد، فيعرف المستدعي والاختبار أن ما حدث توقف محروس لا انهيار، دون قراءة نص عربي.
- `isInputReadinessRejection` لا يقبل إلا رفض هذا الحارس نفسه: `Error` عادي، أو `TypeError`، أو كائن بالشكل نفسه، أو خطأ أُعيدت تسميته فقط — كلها تفشل الفحص.
- المسبار في المقيّم صار يفرّق بين `refused` و`refused-wrong-code` و`refused-untyped` و`accepted-without-choice` و`crashed`.
- ومسبار ثانٍ يسأل الاتجاه المعاكس: بعد تسجيل الاختيار لهذا المصدر وهذه القراءة، هل يمر الحقل نفسه؟ **الحارس الذي يرفض في الحالتين ليس حماية بل منعًا شاملًا يكلّف عملًا حقيقيًا.**
- `run.mjs` يحوّل الاتجاهين إلى بوابة تُفشل التشغيل، خلف `--acceptance-gate`، فتُطبَّق على المرشح وحده وتبقى مقاييس المحركات التاريخية بلا بوابة وبلا تغيير.

**ما أثبتته البوابة، بالبناء لا بالادعاء** — نسخ مكسورة عمدًا من المحرك، بالمقيّم نفسه:

| النسخة | نتيجة المسبار | البوابة | رمز الخروج |
|---|---|---|---:|
| فرع الالتباس محذوف من الحارس | `accepted-without-choice` ×14 | **فشلت** | 1 |
| الحارس يرمي `TypeError` بدل رفضه | `crashed` ×15 | **فشلت** | 1 |
| المرشح | `refused` ×15، `accepted-with-choice` ×14 | نجحت | 0 |

وعلى الحزمة الكاملة: **191 حقلًا ملتبسًا فُحصت، صفر مخالفة**، و`refused` 191، و`accepted-with-choice` 162 مع 29 حقلًا حجبها حقل آخر غير صالح في المصدر نفسه (رفض صحيح لسبب آخر، لا تجاهلًا للإجابة).

**المسار التنفيذي، لا الدالة وحدها:** `tests/ambiguity-gate-acceptance-047.test.ts` يشغّل العامل الحقيقي في `reconcile` و`compare` و`export`، ويستعيد جلسة محفوظة. الالتباس غير المحسوم يُرفض في الأربعة برمز `FORMAT_AMBIGUOUS_UNRESOLVED`، ولا تعود أي قيمة. وبعد تسجيل الإجابة تكتمل المقارنة (54,321 فلسًا بالتفسير المختار) ويُنتَج ملف التصدير فعلًا.

**ثلاث طفرات دائمة، كلها كُشفت:** `047-accept-unanswered-format-ambiguity` و`047-ambiguity-guard-throws-unrelated-error` و`047-reuse-format-choice-across-context`. المجموع 39/39 بلا ناجية.

## 2. ارتباط اختيار الصيغة بسياق القراءة

اختبار الارتباط كشف **ثلاث ثغرات حقيقية**: تغييرات تترك بصمة الملف وأرقام الأعمدة كما هي وتغيّر مع ذلك القيم الداخلة في التفسير، وكان الاختيار القديم ينجو منها جميعًا.

| التغيير | الآلية | قبل | بعد |
|---|---|---|---|
| حدود استخراج PDF | البايتات نفسها والبصمة نفسها، خلايا مختلفة | يُقبل الاختيار القديم | يُرفض |
| استبعاد صف | يقلّ عدد القيم خلف الالتباس (3 ← 2) | يُقبل | يُرفض |
| كتابة رصيد افتتاحي أو ختامي | الرصيد ينضم إلى أدلة المبالغ (2 ← 3) | يُقبل | يُرفض |

**أصغر تعديل يعالجها:** `FormatChoice` صار يحمل الحدود والصفوف المستبعدة والأرصدة المكتوبة، وتُفحص كلها. لم يُضَف حقل لا يُستخدم، ولا بصمة تشفير، ولا نظام توقيع.

**ولا يُبطَل الاختيار بتغيير شكلي:** نوع التقرير، واتجاه الإشارة، وعمود العملة، وعمود الوصف، وتأكيد مراجعة PDF، وسبب استبعاد فارغ، وأرصدة فارغة — كلها تبقي الإجابة. الواجهة تسأل من جديد عند التغييرات المؤثرة بدل أن يصطدم المستخدم بخطأ من المحرك.

**سياسة الاستعادة، صراحةً:**
- **ما يُعاد فحصه:** تُقرأ المصادر من بايتاتها المحفوظة، وتُطابَق بصمتها، وتُشتق التفسيرات المسموح بها من المستند نفسه في كل مرة، ثم يعاد تشغيل الحارس والمطبّع والمقارنة بالكامل.
- **متى يحتاج المستخدم إعادة تأكيد:** إذا تغيّر المصدر أو الورقة أو صف العناوين أو الأعمدة المعنية أو منازل العملة أو حدود الاستخراج أو الصفوف المستبعدة أو الأرصدة المكتوبة، أو إذا لم يعد المستند يسمح بالقيمة المختارة.
- **ما لا يثبته ملف الجلسة:** لا شيء عن مراجعة بشرية. الملف قابل للتعديل، واتساق JSON وبصماته ليسا إثباتًا مستقلًا على أن إنسانًا راجع شيئًا. الحقل المحفوظ يقول «هذه الإجابة أُعطيت لهذا المصدر بهذه القراءة» فقط، والمحرك هو من يقرر هل ما زال السؤال قائمًا أصلًا. حذف الإجابة من ملف محفوظ يجعل الاستعادة ترفض بالرمز نفسه.

## 3. إعادة التشغيل من مستودع نظيف

`work/run-matrix.sh` كان غير منشور، فكان دليل التشغيل يشير إلى ملف لا وجود له في نسخة نظيفة. صار المنطق في `audit/reliability/run-matrix.mjs` بخيارات صريحة: `--engines` بمعرّفات commits مثبتة تُفحص في worktrees مؤقتة، و`--out` و`--worktrees` و`--gate`. وسكربتا المقارنة والأدلة يقبلان `--matrix` و`--out` بدل مسار مثبت. ومحرك «شجرة العمل» يُبلَّغ `HEAD+uncommitted` بدل commit لا يصفه.

**التحقق:** worktree نظيف عند `62a1b64`، بلا أي من مخرجاتي السابقة، شغّل المصفوفة الكاملة بالأمر الموثق وحده:

```
{"engine":"v045","commit":"5fecb15…","suite":"known","exitCode":1,"gated":false}
{"engine":"astra","commit":"5588417…","suite":"known","exitCode":1,"gated":false}
{"engine":"unified","commit":"62a1b64…","suite":"known","exitCode":0,"gated":true}
{"matrix":"…/clean/work/matrix","blocking":0}
```

النتائج طابقت خط الأساس بالضبط: 5,000 ناجحة، 4,196 مقارنة مكتملة، 19,112 حقل صيغة مثبت، 46,083 من 46,717 مطابقة مطلوبة، 634 فائتة، صفر مطابقة خاطئة. والكود المسلَّم مطابق بايتًا بايتًا لما قيس (`lib` و`app` و`audit/reliability` بلا فرق عن `62a1b64`).

الكود اللازم لإعادة التوليد متتبع الآن؛ والأدلة التاريخية والنتائج المؤقتة تبقى في `work/` غير المتتبع. ولم تُرفع ملفات مستخدم خاصة: اختبارات قبول يوليو الاثنا عشر تبقى متخطاة ومعلنة.

## 4. قبول من الواجهة على حالات جديدة

24 زوجًا مؤلفة لهذه الجولة من تركيبات تخطيط **لم تُستخدم لتوجيه إصلاحات 0.4.7** (التي شُخّصت على `C01436` و`C01831` و`C03087` وسيناريو `comma-decimals`). هذه **ليست عينة سوق** وليست مُنتِجات جديدة: الكاتبون هم من يستعملهم المشروع أصلًا. ولم يُستخدم تغيير البذرة دليلًا على اختلاف تنسيق.

**كل الأفعال آلية: محاكاة مستخدم، لا محاسب حقيقي.**

### تصحيح شرط النجاح (الجولة الثانية)

التشغيل الأول كان يقبل الحالة بشروط ناقصة، وصُحّحت ثلاثة عيوب في **الاختبار** لا في المحرك:

1. **العدد المتوقع كان يُسجَّل ولا يُقارن.** `record.expectedMatches` كان يُكتب في السجل ولا يدخل في شرط النجاح إطلاقًا.
2. **غياب الفحص كان يُقبل نجاحًا.** الشرط كان `exportVerified !== false`، فتمر الحالة التي لم يُنفَّذ فحصها أصلًا (`undefined`).
3. **قيمة غير رقمية كانت تمر.** المقارنة كانت `Math.abs(Number(cell) - expected) > 1e-9`؛ و`Number('—')` يساوي `NaN`، وكل مقارنة عددية مع `NaN` تعطي `false`، فيُقبل الصف كأنه مطابق.

وصار الفحص يستخدم **قارئ المخرجات المستقل الموجود** `readOutputWorkbook` (ZIP + SAX + BigInt، بلا ExcelJS وبلا استيراد من المحرك) بدل إعادة القراءة بالمكتبة التي أنشأت الملف — فقراءة الملف بالمكتبة نفسها ليست استقلالًا. والمبالغ تُقرأ بـ`decimalMinor` التي ترمي خطأ على أي قيمة غير صالحة بدل أن تنتج `NaN`.

### النتائج المرجعية لكل حالة

لكل حالة مكتملة تُشتق النتيجة المرجعية من **قاعدة المنتج الموثقة** في `core.ts` (`EXACT_REFERENCE_SIGNED_AMOUNT_UNIQUE_V2`): المرجع متطابق، والمبلغ الموقّع متساوٍ، والتاريخ داخل النافذة، **والمرجع غير مكرر في أي من الطرفين**. ولا تُشتق من مخرجات المحرك.

وتشمل النتيجة المرجعية: صفوف المورد، وصفوف الدفتر، والروابط المطلوبة، **والروابط غير المسموح بها**، والبنود التي يجب أن تبقى للمراجعة أو دون مقابل. العدد وحده لا يكفي: تبديل رابطين يُبقي العدد كما هو ويغيّر أي مستند سُوّي مقابل أيّ.

- **A17** (حركة ناقصة من الدفتر): 4 روابط مطلوبة، و`INV-7005` يبقى دون مقابل على جانب المورد.
- **A18** (مبلغ مختلف): 4 روابط، و`INV-7003` **ممنوع** ربطه — فرق مبلغ يبقى للمراجعة.
- **A19** (مرجع مكرر): `INV-7001` مكرر على الطرفين، فالقاعدة ترفض ربطه آليًا. المطلوب **4 روابط لا 5**، و6 صفوف على كل جانب دون إسقاط، ودون دمج الحركتين المستقلتين، ودون اعتماد ارتباط غير مثبت.

### النتيجة

| الفئة | العدد |
|---|---:|
| إنجاز دون تصحيح للاستخراج | **14** |
| إنجاز بعد تأكيد محدود | **6** |
| إنجاز بعد تصحيح للأعمدة أو القراءة | **0** |
| توقف صحيح | **4** |

**20 ملف تصدير فُحصت كلها مقابل نتيجتها المرجعية المعلنة، وصفر لم يُفحص.** الحالات الأربع المتوقفة لا تنتج ملفًا، وتُعرض `no-export` صراحةً ولا تُحسب ضمن نجاح محاسبي.

| الحالة | ما الجديد فيها | المتوقع | المرصود | روابط مقبولة / مطلوبة | فحص التصدير | تدخل المستخدم | زمن (ms) |
|---|---|---|---|---:|---|---|---:|
| A01 | plain CSV both sides, English header order | completed | completed-without-correction | 5 / 5 | verified | scope:currency، scope:cutoff | 2551 |
| A02 | CSV with a UTF-8 BOM against a quoted CSV | completed | completed-without-correction | 5 / 5 | verified | scope:currency، scope:cutoff | 2440 |
| A03 | semicolon-delimited CSV against a comma CSV | completed | completed-without-correction | 5 / 5 | verified | scope:currency، scope:cutoff | 2450 |
| A04 | reordered columns on the supplier side only | completed | completed-without-correction | 5 / 5 | verified | scope:currency، scope:cutoff | 2547 |
| A05 | Arabic headers against English headers | completed | completed-without-correction | 5 / 5 | verified | scope:currency، scope:cutoff | 2442 |
| A06 | debit/credit pair against a signed amount column | completed | completed-after-limited-confirmation | 5 / 5 | verified | scope:currency، scope:cutoff، confirm:debit-credit-direction | 2486 |
| A07 | a banner above the table on the supplier side | completed | completed-without-correction | 5 / 5 | verified | scope:currency، scope:cutoff | 6772 |
| A08 | a total line below the table on both sides | completed | completed-without-correction | 5 / 5 | verified | scope:currency، scope:cutoff | 2556 |
| A09 | XLSX against CSV | completed | completed-without-correction | 5 / 5 | verified | scope:currency، scope:cutoff | 2674 |
| A10 | XLSX both sides, different sheet names | completed | completed-without-correction | 5 / 5 | verified | scope:currency، scope:cutoff | 2757 |
| A11 | XLSX with a banner and a trailing note | completed | completed-without-correction | 5 / 5 | verified | scope:currency، scope:cutoff | 2625 |
| A12 | XLSX debit/credit against XLSX signed | completed | completed-after-limited-confirmation | 5 / 5 | verified | scope:currency، scope:cutoff، confirm:debit-credit-direction | 2701 |
| A13 | single-page PDF against CSV | completed | completed-after-limited-confirmation | 3 / 3 | verified | scope:currency، scope:cutoff، confirm:pdf-review | 3861 |
| A14 | two-page PDF with the header repeated on page two | completed | completed-after-limited-confirmation | 5 / 5 | verified | scope:currency، scope:cutoff، confirm:pdf-review | 3872 |
| A15 | PDF against XLSX | completed | completed-after-limited-confirmation | 3 / 3 | verified | scope:currency، scope:cutoff، confirm:pdf-review | 3888 |
| A16 | PDF with reordered columns | completed | completed-after-limited-confirmation | 3 / 3 | verified | scope:currency، scope:cutoff، confirm:pdf-review | 3860 |
| A17 | one movement missing from the ledger side | completed | completed-without-correction | 4 / 4 | verified | scope:currency، scope:cutoff | 2790 |
| A18 | one amount differs between the two sides | completed | completed-without-correction | 4 / 4 | verified | scope:currency، scope:cutoff | 3887 |
| A19 | a duplicate reference on both sides | completed | completed-without-correction | 4 / 4 | verified | scope:currency، scope:cutoff | 2468 |
| A20 | three-decimal currency, unambiguous amounts | completed | completed-without-correction | 5 / 5 | verified | scope:currency، scope:cutoff | 2517 |
| A21 | three-decimal currency where every amount reads two ways | blocked-needs-format-choice | correct-stop | — / — | لا تصدير | scope:currency، scope:cutoff | 6025 |
| A22 | a calendar-impossible date on the supplier side | blocked-unreadable | correct-stop | — / — | لا تصدير | scope:currency، scope:cutoff | 1007 |
| A23 | a supplier file with no movement rows at all | blocked-unreadable | correct-stop | — / — | لا تصدير | scope:currency، scope:cutoff | 1983 |
| A24 | a PDF page carrying no extractable text | blocked-unreadable | correct-stop | — / — | لا تصدير | لا شيء | 3182 |

التدخلات: `scope:currency` و`scope:cutoff` (حقائق مطبوعة على المصدر، ليست تصحيحًا للاستخراج)، و`confirm:pdf-review` ×4، و`confirm:debit-credit-direction` ×2. لم يُخفَّف أي حاجز، ولم يُدخل تأكيد على ملف لم يطلبه.

**التوقفات الأربعة، كل منها للسبب المعلن له** (توقف لسبب آخر يُفشل الحالة): A21 سؤال الالتباس نفسه مرئيًا من الواجهة، وA22 تاريخ غير موجود في التقويم، وA23 مصدر بلا حركات، وA24 ملف PDF رُفض عند القراءة.

### ما تكشفه الجولة الآن ولم تكن تكشفه

`tests/acceptance-verifier-047.test.ts` — تسعة اختبارات على مخرجات معطوبة عمدًا، **دون إفساد كود الإنتاج**:

| الاختبار | ما يثبته |
|---|---|
| تبديل رابطين | يفشل رغم بقاء العدد 3 كما هو |
| رابط ممنوع اعتُمد | يفشل |
| إسقاط صف من أي من الطرفين | يفشل على الجانبين |
| مبلغ تغيّر | يفشل |
| مبلغ `—` أو فارغ أو `n/a` | يرمي خطأ بدل أن يمر عبر `NaN` |
| بند كان يجب بقاؤه دون مقابل | يفشل |
| تصدير لم يُفحص (`not-declared` أو `verifier-error`) | ليس نجاحًا |
| عدد الروابط يخالف المعلن | ليس نجاحًا |
| بلوغ شاشة النتائج في حالة توقف | ليس نجاحًا |

### علاقة هذه الجولة بسابقتها

نتيجة التشغيل السابق (24/24 مع فحص أضيق) **تحقق أضيق**، لا نتيجة معادلة: كان يقارن صفوف المورد وحدها، ولا يفحص عضوية المطابقات ولا صفوف الدفتر ولا البنود المفتوحة، ويقبل حالة بلا فحص. توسيع الاختبار **ليس تحسنًا في المحرك**: لم يتغير المحرك في هذه المهمة، ولم تُعَد المصفوفة التاريخية، وأرقام 0.4.7 في القسم 5 من تشغيل المحرك السابق نفسه بلا تغيير.

عيب واحد ظهر عند أول تشغيل بالفحص الموسّع (A17) وكان **خطأ في توقع الاختبار لا في المحرك**: كتبتُ اسم الجانب بالعربية بينما يكتب التصدير قيمة `side` نفسها (`supplier`/`ledger`). صُحّح التوقع إلى مفردات المنتج. المحرك كان قد ترك `INV-7005` دون مقابل بالفعل وهو السلوك الصحيح.

## 5. نتائج التشغيل

| الأمر | النتيجة |
|---|---|
| `pnpm typecheck` | نجح |
| `pnpm test` | 648 اختبارًا: 636 ناجحًا، 0 فاشلًا، 12 متخطيًا |
| `pnpm test:mutations` | خط الأساس ناجح، **39/39** طفرة كُشفت، 0 ناجية |
| `pnpm build` | نجح |
| `pnpm test:browser` | اجتاز، بما فيه «لا طلبات خارجية ولا POST» |
| `pnpm test:reliability` (كاملة، مع البوابة) | 5,000/5,000، البوابة نجحت، الرمز 0 |
| جولة الواجهة | 24/24، و20 تصديرًا من 20 مفحوصًا مقابل نتيجته المرجعية |

الاثنا عشر المتخطاة هي حزمة قبول يوليو التي تحتاج الملفات الأصلية الخاصة؛ استُبعدت عمدًا ولم تُرفع. **لم يُعَد التحقق من حالة 6,750 = 2,500 + 2,250 + 2,000 هنا** ولا ندّعي ذلك.

## 6. الفجوات الباقية

- **634 مطابقة مطلوبة فائتة في 119 حالة**، كلها نتيجتها `external-information-required`. المقيّم يصنّف 46,083 من 46,717 كقابلة للحسم من المستند، والمحرك ينجزها كلها. الباقي يحتاج قرار المحاسب، وليس فجوة قراءة.
- **251 حالة تستخدم افتراضًا غير مثبت**، كلها فئة `invalid`: تاريخ مستحيل (50)، فواصل مبلغ غير صحيحة (50)، صيغة Excel بلا قيمة مخزنة (50)، ملف فارغ (50)، عمود مبلغ مفقود (49)، وتعيين يدوي على مصدر ناقص (2).
- خارج الاعتماد الآلي كما كان: الصور وOCR غير المتحقق، وتقسيم المرجع بين الأسطر، والنطاقات المتعددة، والتخصيص المتقدم للدفعات. لم تُرفع حدود المنتج.
- الحزمة صناعية داخلية، والحجز `final` ليس مجهولًا لأن حالات منه قُرئت أثناء التشخيص، والمراجعة الثانية من المنفذ نفسه.

## 7. الحكم ومعيار التوقف

اجتاز المرشح هذه الجولة: بوابة القبول ملزمة وأُثبتت بالبناء ضد نسختين مكسورتين، وارتباط الاختيار بسياقه أُغلقت فيه ثلاث ثغرات حقيقية، وإعادة التشغيل تعمل من نسخة نظيفة، وجولة الواجهة 24/24 دون تخفيف أي حاجز.

**يُثبَّت `integration/0.4.7-unified` مرشحًا لتجربة محدودة تحت إشراف محاسب.** لا تعديلات مفتوحة بعد هذه النقطة: أي تطوير لاحق يجب أن يستند إلى عطل جديد قابل لإعادة الإنتاج أو احتياج استخدام موثق.

هذا ليس جاهزية إطلاق عام لـPDF متنوع، ولا ضمان دقة ميدانية.

## 8. إعادة التشغيل

```sh
pnpm install --frozen-lockfile
pnpm typecheck && pnpm test && pnpm test:mutations && pnpm build
MIZAN_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome pnpm test:browser

# الحزمة الكاملة مع بوابة القبول
node --experimental-strip-types audit/reliability/run.mjs \
  --suite known --split development,validation,final --acceptance-gate \
  --output work/known-unified

# مصفوفة المحركات الثلاثة من نسخة نظيفة، بمعرّفات مثبتة
node --experimental-strip-types audit/reliability/run-matrix.mjs \
  --engines v045=5fecb15,astra=5588417,unified=. \
  --out work/matrix --worktrees work/engine-roots
node audit/reliability/compare-matrix-047.mjs --suite known --matrix work/matrix
node audit/reliability/compare-matrix-047.mjs --suite focused --matrix work/matrix

# اختبارات مدقق الجولة على مخرجات معطوبة عمدًا
node --experimental-strip-types --test tests/acceptance-verifier-047.test.ts

# جولة الواجهة
pnpm build
MIZAN_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
  node --experimental-strip-types scripts/browser-acceptance-047.mjs \
  --out work/acceptance-047.json

# الأدلة المجمعة
node audit/reliability/build-evidence-047.mjs \
  --matrix work/matrix --acceptance work/acceptance-047.json
# أو، إذا لم يتغير المحرك وأُعيدت جولة الواجهة وحدها:
node audit/reliability/build-evidence-047.mjs \
  --only-acceptance --acceptance work/acceptance-047.json
```

الأدلة في [`audit/reliability/evidence-0.4.7.json`](../audit/reliability/evidence-0.4.7.json): إصدارات الأدوات لكل تشغيل، ونتائج الحزمتين، وحالة بوابة القبول واتجاهيها، وجولة الواجهة كاملة بحالاتها وأزمنتها، وتصنيف الفجوات الباقية، وما لم يُتحقق منه.
