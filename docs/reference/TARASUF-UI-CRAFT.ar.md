# دمج Tarasuf UI Craft

مهارة مشروع تستند إلى عقود تراصف الحالية. لا تثبت تلقائيًا في حساب ChatGPT أو مجلد مهارات شخصي. المهمة لا تغيّر التطبيق أو محركاته أو أصوله أو إصدار 0.4.57 أو مسار نشره.

## الملفات

| الملف | المسؤولية |
| --- | --- |
| [SKILL.md](../../.agents/skills/tarasuf-ui-craft/SKILL.md) | المدخل الأصلي، الأوضاع الأربعة ومسار القرار بعشر خطوات |
| [identity.md](../../.agents/skills/tarasuf-ui-craft/references/identity.md) | سلطة المراجع والهوية وخريطة الأصول وحسم التعارض |
| [engineering.md](../../.agents/skills/tarasuf-ui-craft/references/engineering.md) | الهندسة والمكونات والتفاعل والإتاحة واللغتان والأداء |
| [financial-ux.md](../../.agents/skills/tarasuf-ui-craft/references/financial-ux.md) | المصادر والحالات والأرقام والأدلة والقرارات والاستمرارية والصادر |
| [domains.md](../../.agents/skills/tarasuf-ui-craft/references/domains.md) | الأنواع الاثنا عشر وأدوار المصادر وربطها بالتنفيذ |
| [creative-motion.md](../../.agents/skills/tarasuf-ui-craft/references/creative-motion.md) | توليد اتجاه مميز ووظيفي ومشاهد وحركة ضمن الهوية |
| [verification.md](../../.agents/skills/tarasuf-ui-craft/references/verification.md) | معايير القبول وربط التعديل بفحوص المستودع |
| [provenance.md](../../.agents/skills/tarasuf-ui-craft/references/provenance.md) و[التراخيص](../../.agents/skills/tarasuf-ui-craft/licenses) | الإسناد والمراجعات المثبتة ونصا الرخصتين |
| [openai.yaml](../../.agents/skills/tarasuf-ui-craft/agents/openai.yaml) | بيانات العرض والاستدعاء في Codex |
| [validate.py](../../.agents/skills/tarasuf-ui-craft/scripts/validate.py) | تحقق ساكن وروابط وربط مجالات وضوابط سلبية |
| [مدخل Claude](../../.claude/skills/tarasuf-ui-craft/SKILL.md) | إحالة خفيفة إلى الأصل دون نسخ القواعد |
| [المراجعة النقدية](../audits/TARASUF-UI-CRAFT-REVIEW.ar.md) | المحاور العشرة والاعتماد والتعديل والاستبعاد والإضافات |

أضيفت إحالة في [AGENTS](../../AGENTS.md) و[CLAUDE](../../CLAUDE.md). حارس النشر يرفض الروابط الرمزية، لذلك استُخدم مدخل إحالة نصي صغير. القواعد تصان في الأصل فقط. يقرأ الوكيل المراجع المطلوبة للمهمة بدل تحميل جميع التفاصيل مسبقًا.

## الاستخدام

بعد جلب الفرع `feat/tarasuf-ui-craft` وفتحه من جذر المشروع:

```text
Claude Code:
/tarasuf-ui-craft Audit راجع شاشة نتائج البنك دون تعديل
/tarasuf-ui-craft Refine حسّن محاذاة الأعمدة دون تغيير القيم والحالات
/tarasuf-ui-craft Design اقترح تجربة عرض دليل ضمن الهوية الحالية
/tarasuf-ui-craft Review راجع التغييرات الحالية واختبر الانحدارات

Codex:
$tarasuf-ui-craft Audit راجع مكونات رفع المصادر المشتركة دون تعديل
$tarasuf-ui-craft Refine أصلح المشكلة المحددة واختبر الحالات المتأثرة
```

مسار `.agents/skills` موثق في [دليل Codex](https://developers.openai.com/codex/skills). مدخل Claude يتبع `.claude/skills`؛ تعذر جلب [توثيق Claude](https://code.claude.com/docs/en/skills) في الدراسة الأولى، ولم يُختبر الاكتشاف داخل عميل فعلي. لم يُختبر أيضًا منتقي مهارات Codex المستقل. إذا لم يعرض العميل المهارة، اطلب قراءة المدخل الأصلي صراحة؛ صحة الملفات ليست إثباتًا لاكتشاف العميل.

## توافق التعليمات

| مرجع تراصف | التزام المهارة |
| --- | --- |
| DESIGN وVISUAL-IMPLEMENTATION | حفظ الأبيض والكحلي والتدرج وثمانية والمشاهد؛ التحقق من المستهلك الحالي عند اختلاف اللقطة التاريخية |
| WORKSPACE-IDENTITY | قائمة واحدة ورفع مشترك وأدوار صحيحة؛ لا قلب للمصفوفة أو فك تركيب العمل |
| VISION وACCOUNTING-CONTRACT | الدقة والأدلة والخصوصية أعلى من الشكل؛ الاقتراح لا يعتمد والمطابقة لا تثبت الأرصدة |
| ARCHITECTURE | React/Vite والعامل والحالة القائمة؛ لا افتراض Next.js من المجلد |
| QUALITY وDELIVERY | دليل من المرشح نفسه، ولا تخفيف بوابة أو تحديث بصمات distribution لمهمة وثائق |

مواضع الفحص اللاحقة: `.reveal-ready` القديمة مقابل `.tarasuf-reveal-pending`، tracking المبكر مقابل overrides، محاذاة TableHead وtransition-all في Button، وخط المشاركة المختلف عن العناوين الحية. هذه مخاطر/ملاحظات مصدرية، وليست عيوبًا مرئية أعيد إنتاجها. الحسم بتعيين المستهلك والـcomputed style وفحص الحالة واللغة ثم تعديل محدود عند ثبوت المشكلة. لم تُغير صامتًا.

## إعادة التحقق

```sh
python3 .agents/skills/tarasuf-ui-craft/scripts/validate.py --self-test
git diff --cached --check -- . ':(exclude).agents/skills/tarasuf-ui-craft/licenses/unslop-CC-BY-4.0.txt'
node --test scripts/public-content-check.test.mjs
node scripts/public-content-check.mjs --source
node scripts/public-content-check.mjs --source-export
```

جهّز المرشح في Git قبل source-export لأنه يفحص الملفات المتتبعة. تحدث سجلات source المراجعة فقط، دون إقرار كل محتويات المجلد أو تغيير distribution. استثنيت رخصة CC BY وحدها من whitespace لأن الأصل ينتهي بسطر فارغ إضافي؛ تحفظ الرخصة كما هي وتفحص بصمتها. validator لا يثبت جمال التصميم أو الفهم المحاسبي أو توافق WCAG.

## سجل التحقق وحدوده

أساس المستودع `013b464f8152abe5f26082ccb4f82f3b630e6f57`. بدأت الدراسة في 30 أكتوبر 2026، وأعيدت الملفات وفحوصها في 31 أكتوبر بعد فقد النسخة المحلية قبل اكتمال الرفع. يؤخذ الالتزام النهائي من سجل الفرع بدل تضمين بصمة ذاتية.

| التحقق المنفذ على الملفات المعاد إنشاؤها | النتيجة وحدودها |
| --- | --- |
| quick_validate للمدخل الأصلي ومدخل Claude | نجح كلاهما؛ بنية وfrontmatter فقط |
| validator الخاص | نجح: 102 رابط محلي، سبعة مراجع، 12 معرف مجال، وربط primaryIndices المحدد والمداخل وبصمات الرخصتين |
| الضوابط السلبية | 10/10 اكتُشفت في الذاكرة: اسم ووضع ورابط وanchor ومرجع ومجال وربط مصدر وإحالة وmetadata ورخصة؛ لا تعديل لملفات التطبيق |
| حارس النشر | اختبارات الحارس 23/23؛ فحص source وsource-export اجتاز مخزون 6196 ملفًا؛ سجلات distribution لم تتغير |
| تقييم Review من سياق مستقل | حدد خمسة مخاطر P0 وخطر P1 في المقترحات: اعتماد البنك من الحركات، فقد دقة المال، قلب أدوار المصدر، فقد العمل بفك التركيب، صادر من الصفوف المرئية، وإلغاء input الأصلي. أوضح أن الطي ليس عيبًا بذاته وأن البنك يملك details بالفعل |
| تقييم Design من سياق مستقل | قارن امتداد A4 بنداء دليل مع لوحة مقارنة كبيرة؛ اختار الأول للمقدمة وربطه بمسار TransactionReview القائم. رفض ادعاء وجود عارض أصل/تظليل خلية عام بلا دليل، وحفظ جميع أعضاء المجموعة وأدوار المجالات |
| النطاق والـwhitespace | 18 ملفًا للمهارة والتوجيه والتوثيق وقائمة المصدر؛ لا runtime أو أصول أو اعتماديات. فحص whitespace يستثني رخصة CC BY المنسوخة حرفيًا فقط |

أعيد التقييمان المستقلان على الملفات المعاد إنشاؤها، دون إعطاء المراجعين الإجابة المتوقعة أو تشخيص الكاتب، ودون تعديل تطبيق أو تشغيل محركات. هما دليل على قرار مراجعة واقتراح تصميم في مهمتين، لا تعميم لجودة المهارة أو اختبار تنفيذ Frontend. Node المحلي `24.22.1`؛ لم تثبت اعتمادات التطبيق أو تغير إصداراته.

غير متحقق: اكتشاف المهارة في العميل الفعلي، تنفيذ Refine على واجهة، screenshots لتطبيق معدل، الاختبارات المالية والمتصفح الشاملة، قارئ شاشة فعلي، أداء أجهزة ضعيفة أو شهادة WCAG كاملة. لم تتغير الواجهة؛ لا دمج في main ولا نشر للموقع.
