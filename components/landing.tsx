import { useEffect, useRef, type RefObject } from 'react';
import {
  ArrowLeft,
  ArrowDownLeft,
  Check,
  CheckCheck,
  ChevronDown,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  Fingerprint,
  GitCompareArrows,
  HardDrive,
  Link2,
  LockKeyhole,
  ShieldCheck,
} from 'lucide-react';
import { BrandMark, DisplayHeading } from '@/components/brand';
import { DocumentScene } from '@/components/document-scene';
import '@/app/landing-details.css';

/** Sections stay readable when motion or intersection observation is unavailable. */
function useLandingReveal(root: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const container = root.current;
    if (!container || !('IntersectionObserver' in window)) return;
    const motionPreference = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    );
    const elements = Array.from(container.querySelectorAll('[data-reveal]'));
    let observer: IntersectionObserver | undefined;

    const revealAll = () => {
      observer?.disconnect();
      elements.forEach((element) => element.classList.add('is-revealed'));
    };
    const start = () => {
      if (motionPreference.matches) {
        revealAll();
        return;
      }
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-revealed');
              observer?.unobserve(entry.target);
            }
          });
        },
        { threshold: 0, rootMargin: '0px 0px -24px 0px' },
      );
      elements.forEach((element) => {
        // Visible content never flashes away while the observer initializes.
        const bounds = element.getBoundingClientRect();
        if (bounds.top < window.innerHeight && bounds.bottom > 0) {
          element.classList.add('is-revealed');
        } else if (!element.classList.contains('is-revealed')) {
          element.classList.add('tarasuf-reveal-pending');
          observer?.observe(element);
        }
      });
    };
    start();
    const onMotionChange = () => {
      if (motionPreference.matches) revealAll();
    };
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof Element) {
        event.target.closest('[data-reveal]')?.classList.add('is-revealed');
      }
    };
    motionPreference.addEventListener('change', onMotionChange);
    container.addEventListener('focusin', onFocus);
    return () => {
      revealAll();
      motionPreference.removeEventListener('change', onMotionChange);
      container.removeEventListener('focusin', onFocus);
    };
  }, [root]);
}

export function LandingIntro() {
  return (
    <div className="landing-intro" id="top">
      <div className="hero-inner">
        <div className="hero-copy">
          <div className="hero-eyebrow">
            <span /> مساحة تسوية الموردين
          </div>
          <h1 className="hero-title">
            <DisplayHeading id="heroLine1" />
            <DisplayHeading id="heroLine2" />
          </h1>
          <p className="hero-description">
            من كشف المورد إلى دفترك المحاسبي.
            <br />
            قارن الحركات، افهم الفروق، وارجع إلى مصدر كل نتيجة.
          </p>
          <div className="hero-actions">
            <a href="#reconciliation" className="primary-link">
              ابدأ المطابقة <ArrowLeft size={19} />
            </a>
            <a href="#how-it-works" className="quiet-link">
              كيف تعمل تراصف؟
            </a>
          </div>
          <p className="hero-privacy">
            <LockKeyhole size={14} /> معالجة على جهازك. دون إنشاء حساب.
          </p>
        </div>
        <DocumentScene />
      </div>
      <div className="hero-bottomline">
        <span>من البيانات إلى الوضوح</span>
        <span>صُمّمت للمحاسب، ولتفاصيل عمله.</span>
      </div>
    </div>
  );
}

export function LandingBenefits() {
  const root = useRef<HTMLDivElement>(null);
  useLandingReveal(root);
  return (
    <div className="tarasuf-benefits-wrap" ref={root}>
      <section
        className="tarasuf-benefits"
        aria-labelledby="benefits-title"
        data-reveal
      >
        <div className="tarasuf-benefits-heading">
          <span className="tarasuf-section-kicker">ما يصنع الفارق</span>
          <h2 id="benefits-title">الثقة في التفاصيل.</h2>
          <p>خصوصية تحفظها، وخطوات تختصرها، ونتيجة تفهمها.</p>
        </div>
        <div className="tarasuf-benefits-strip">
          <article className="tarasuf-benefit tarasuf-benefit-local">
            <div className="tarasuf-benefit-symbol" aria-hidden="true">
              <span className="tarasuf-symbol-orbit" />
              <LockKeyhole size={26} strokeWidth={1.5} />
              <span className="tarasuf-symbol-status">
                <Check size={9} />
              </span>
            </div>
            <span className="tarasuf-benefit-label">الخصوصية أولًا</span>
            <h3>المعالجة هنا. على جهازك.</h3>
            <p>
              لا نرفع ملفاتك إلى خادم معالجة، ولا نحفظ معاملاتك تلقائيًا بين
              الجلسات.
            </p>
            <a href="#privacy">
              تعرّف على حدود الخصوصية <ArrowLeft size={15} />
            </a>
          </article>
          <article className="tarasuf-benefit tarasuf-benefit-flow">
            <div className="tarasuf-benefit-symbol" aria-hidden="true">
              <span className="tarasuf-flow-line" />
              <GitCompareArrows size={28} strokeWidth={1.5} />
            </div>
            <span className="tarasuf-benefit-label">خطوات مباشرة</span>
            <h3>ابدأ بملفّين. ركّز على الفروق.</h3>
            <p>
              قراءة البيانات ثم المقارنة والمراجعة. تستكمل ما ينقص بدل إعادة
              إدخال كل شيء.
            </p>
            <span className="tarasuf-benefit-note">
              <CheckCheck size={15} /> دون تسجيل أو إعداد تقني
            </span>
          </article>
          <article className="tarasuf-benefit tarasuf-benefit-evidence">
            <div className="tarasuf-benefit-symbol" aria-hidden="true">
              <Fingerprint size={29} strokeWidth={1.5} />
              <span className="tarasuf-symbol-trace" />
            </div>
            <span className="tarasuf-benefit-label">نتائج قابلة للمراجعة</span>
            <h3>لكلّ نتيجة، دليل ترجع إليه.</h3>
            <p>
              تتبّع الحركة إلى مصدرها، وافهم سبب المطابقة. وما لم يثبت يبقى
              للمراجعة.
            </p>
            <span className="tarasuf-benefit-note">
              <Link2 size={15} /> المصدر والسبب مع النتيجة
            </span>
          </article>
        </div>
      </section>
    </div>
  );
}

function ProcessVisual({ step }: { step: number }) {
  return (
    <div
      className={`tarasuf-process-visual tarasuf-process-visual-${step}`}
      aria-hidden="true"
    >
      {step === 1 && (
        <div className="tarasuf-process-files">
          <span>
            <FileText size={22} strokeWidth={1.4} />
            <i />
            <i />
            <small>كشف المورد</small>
          </span>
          <span>
            <FileSpreadsheet size={22} strokeWidth={1.4} />
            <i />
            <i />
            <small>دفتر الحسابات</small>
          </span>
          <b>
            <Check size={13} />
          </b>
        </div>
      )}
      {step === 2 && (
        <div className="tarasuf-process-evidence">
          <span>
            <i className="tarasuf-evidence-confirmed" />
            <b>مطابقة موثقة</b>
            <Check size={12} />
          </span>
          <span>
            <i className="tarasuf-evidence-difference" />
            <b>فرق ظاهر</b>
            <span>≠</span>
          </span>
          <span>
            <i className="tarasuf-evidence-review" />
            <b>يحتاج مراجعة</b>
            <span>…</span>
          </span>
        </div>
      )}
      {step === 3 && (
        <div className="tarasuf-process-workpaper">
          <span>
            <FileCheck2 size={20} strokeWidth={1.5} />
            <b>ورقة العمل</b>
            <Check size={13} />
          </span>
          <div>
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
          <small>النتائج · المصادر · الملاحظات</small>
        </div>
      )}
    </div>
  );
}

function PrivacyBoundary() {
  return (
    <div className="tarasuf-privacy-diagram" aria-hidden="true">
      <div className="tarasuf-device-boundary">
        <div className="tarasuf-device-bar">
          <span>
            <i />
            <i />
            <i />
          </span>
          <b>
            <LockKeyhole size={11} /> داخل متصفحك
          </b>
        </div>
        <div className="tarasuf-device-route">
          <div className="tarasuf-device-endpoint">
            <FileText size={22} strokeWidth={1.4} />
            <span>ملفّاتك</span>
          </div>
          <i className="tarasuf-device-connector" />
          <div className="tarasuf-device-brand">
            <BrandMark />
          </div>
          <i className="tarasuf-device-connector" />
          <div className="tarasuf-device-endpoint">
            <FileCheck2 size={22} strokeWidth={1.4} />
            <span>نتائجك</span>
          </div>
        </div>
        <p>
          قراءة <span /> مقارنة <span /> تصدير
        </p>
        <div className="tarasuf-device-local">
          <HardDrive size={13} />
          <span>مساحة المعالجة على جهازك</span>
          <i />
        </div>
      </div>
      <span className="tarasuf-privacy-boundary-label">
        <ShieldCheck size={15} /> بيانات التسوية تبقى ضمن هذه الحدود
      </span>
    </div>
  );
}

export function LandingDetails() {
  const root = useRef<HTMLDivElement>(null);
  useLandingReveal(root);
  return (
    <div className="tarasuf-landing-details" ref={root}>
      <section
        className="tarasuf-process"
        id="how-it-works"
        aria-labelledby="process-title"
        data-reveal
      >
        <div className="tarasuf-detail-heading">
          <span className="tarasuf-section-kicker">رحلة العمل</span>
          <h2 id="process-title">
            <DisplayHeading id="process" />
          </h2>
          <p>من ملفّين مختلفين إلى ورقة عمل يمكنك الرجوع إليها.</p>
        </div>
        <ol className="tarasuf-process-track">
          {[
            {
              title: 'أضف الملفّين',
              text: 'كشف المورد وتقريرك المحاسبي. يقرأ المحرك البيانات، ويُظهر ما يحتاج مراجعتك.',
              detail: 'البيانات من مصدرها',
            },
            {
              title: 'راجع ما يستحق انتباهك',
              text: 'مطابقات لها دليل، وفروق ظاهرة، وحالات تحتاج قرارك. راجع الحركة ومصدرها معًا.',
              detail: 'كلّ فرق في مكانه',
            },
            {
              title: 'خذ النتيجة بتفاصيلها',
              text: 'صدّر ورقة Excel تجمع النتائج والمصادر وملاحظاتك، لتكمل المراجعة أنت وفريقك.',
              detail: 'ورقة عمل قابلة للتتبّع',
            },
          ].map(({ title, text, detail }, index) => (
            <li className="tarasuf-process-step" key={title}>
              <div className="tarasuf-process-step-top">
                <span>{['١', '٢', '٣'][index]}</span>
                <small>{detail}</small>
              </div>
              <ProcessVisual step={index + 1} />
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </section>
      <section
        className="tarasuf-privacy"
        id="privacy"
        aria-labelledby="privacy-title"
        data-reveal
      >
        <div className="tarasuf-privacy-copy">
          <span className="tarasuf-section-kicker">خصوصية في أصل التصميم</span>
          <h2 id="privacy-title">
            <DisplayHeading id="privacy" />
          </h2>
          <p>
            ملفّات الموردين تحمل تفاصيل عملك. لذلك تتم القراءة والمقارنة والتصدير
            داخل متصفحك، دون إرسال الملفات أو بيانات التسوية إلى خادم معالجة.
          </p>
          <div className="tarasuf-privacy-assurances">
            <span>
              <Check size={14} /> لا حفظ تلقائي للمعاملات
            </span>
            <span>
              <Check size={14} /> لا أدوات تتبّع داخل التطبيق
            </span>
          </div>
          <a className="tarasuf-detail-link" href="#privacy-details">
            اقرأ حدود الخصوصية بالتفصيل <ArrowDownLeft size={17} />
          </a>
        </div>
        <PrivacyBoundary />
      </section>
      <section
        className="tarasuf-privacy-formal"
        id="privacy-details"
        aria-labelledby="privacy-formal-title"
        data-reveal
      >
        <div className="tarasuf-privacy-formal-heading">
          <span className="tarasuf-section-kicker">بوضوح، حتى في التفاصيل</span>
          <h2 id="privacy-formal-title">حدود الخصوصية</h2>
          <p>ما يبقى داخل المتصفح، وما تختار حفظه بنفسك.</p>
        </div>
        <div className="tarasuf-privacy-disclosures">
          <details>
            <summary>
              أين تُعالج الملفات وبيانات التسوية؟
              <ChevronDown size={17} />
            </summary>
            <p>
              تُقرأ الملفات وأسماؤها وحركاتها داخل المتصفح، وتتم المقارنة وإعداد
              التصدير على جهازك. لا يرسل التطبيق هذه البيانات إلى خادم معالجة أو
              خدمة ذكاء اصطناعي خارجية، ولا يتضمن أدوات تحليلات أو تتبّع للاستخدام.
            </p>
          </details>
          <details>
            <summary>
              ما الذي يُحفظ، وما الذي لا يُحفظ؟
              <ChevronDown size={17} />
            </summary>
            <p>
              لا يحفظ التطبيق معاملات التسوية تلقائيًا بين الجلسات. إذا اخترت حفظ
              قالب أعمدة، تُحفظ أرقام الأعمدة وتفضيلات القراءة محليًا في متصفحك،
              ويمكن مسحها من لوحة الخصوصية أعلى الصفحة. ورقة العمل وملف الجلسة
              اللذان تختار تنزيلهما يبقيان على جهازك حتى تحذفهما؛ أنت تتحكم في
              حفظهما ومشاركتهما.
            </p>
          </details>
          <details>
            <summary>
              هل يحتاج العمل إلى اتصال بالإنترنت؟
              <ChevronDown size={17} />
            </summary>
            <p>
              تحتاج إلى الإنترنت لفتح الموقع وتحميل ملفاته. يعمل المسار الذي
              اكتمل تحميله دون اتصال، وقد تحتاج الأدوات التي لم تُحمّل بعد إلى
              الاتصال أولًا. إعادة فتح الموقع من جديد دون إنترنت غير مدعومة في هذه
              النسخة.
            </p>
          </details>
          <details>
            <summary>
              ما حدود حماية التطبيق؟
              <ChevronDown size={17} />
            </summary>
            <p>
              يقدم مضيف الموقع ملفات التطبيق، وقد يسجل بيانات الزيارة وفق
              سياسته؛ لا نرسل إليه ملفات التسوية. لا يستطيع التطبيق ضمان سلامة
              جهازك أو إضافات متصفحك، ولا التحكم في النسخ التي تنزّلها أو تشاركها
              خارج التطبيق.
            </p>
          </details>
        </div>
      </section>
    </div>
  );
}
