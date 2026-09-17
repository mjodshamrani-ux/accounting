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
  Link2,
  LockKeyhole,
  ShieldCheck,
  MessageSquareText,
} from 'lucide-react';
import { BrandMark, DisplayHeading } from '@/components/brand';
import { DocumentScene } from '@/components/document-scene';
import { FeatureArt } from '@/components/feature-art';
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
        let target: Element | null = event.target;
        while (target && container.contains(target)) {
          if (target.matches('[data-reveal]'))
            target.classList.add('is-revealed');
          target = target.parentElement;
        }
      }
    };
    const onHashChange = () => {
      let anchor: Element | null = null;
      try {
        anchor = document.getElementById(
          decodeURIComponent(window.location.hash.slice(1)),
        );
      } catch {
        return;
      }
      if (!anchor || !container.contains(anchor)) return;
      let target: Element | null = anchor;
      while (target && container.contains(target)) {
        if (target.matches('[data-reveal]'))
          target.classList.add('is-revealed');
        target = target.parentElement;
      }
      anchor
        .querySelectorAll('[data-reveal]')
        .forEach((element) => element.classList.add('is-revealed'));
    };
    onHashChange();
    motionPreference.addEventListener('change', onMotionChange);
    container.addEventListener('focusin', onFocus);
    window.addEventListener('hashchange', onHashChange);
    return () => {
      observer?.disconnect();
      // Leave unobserved content readable without marking it as already seen.
      // StrictMode can then observe offscreen elements on its next setup.
      elements.forEach((element) =>
        element.classList.remove('tarasuf-reveal-pending'),
      );
      motionPreference.removeEventListener('change', onMotionChange);
      container.removeEventListener('focusin', onFocus);
      window.removeEventListener('hashchange', onHashChange);
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
      <section className="tarasuf-benefits" aria-labelledby="benefits-title">
        <div className="tarasuf-benefits-heading" data-reveal>
          <span className="tarasuf-section-kicker">ما يصنع الفارق</span>
          <h2 id="benefits-title">الثقة في التفاصيل.</h2>
          <p>خصوصية تحفظها، وخطوات تختصرها، ونتيجة تفهمها.</p>
        </div>
        <div className="tarasuf-benefits-strip">
          <article
            className="tarasuf-benefit tarasuf-benefit-local"
            data-reveal
          >
            <div className="tarasuf-benefit-copy">
              <span className="tarasuf-benefit-label">
                <span /> الخصوصية أولًا
              </span>
              <h3>خصوصيتك، داخل حدود جهازك.</h3>
              <p>
                ملفّاتك لا تغادر إلى خادم معالجة. القراءة والمقارنة تتم على جهازك،
                دون حفظ تلقائي للمعاملات بين الجلسات.
              </p>
            </div>
            <div className="tarasuf-feature-stage">
              <FeatureArt kind="privacy" />
            </div>
            <div className="tarasuf-benefit-footer">
              <a href="#privacy">
                تعرّف على حدود الخصوصية <ArrowLeft size={16} />
              </a>
              <span className="tarasuf-feature-seal" aria-hidden="true">
                <ShieldCheck size={14} /> محليّة بطبيعتها
              </span>
            </div>
          </article>
          <article
            className="tarasuf-benefit tarasuf-benefit-evidence"
            data-reveal
          >
            <div className="tarasuf-benefit-copy">
              <span className="tarasuf-benefit-label">
                <span /> نتائج قابلة للمراجعة
              </span>
              <h3>الدليل بجانب النتيجة.</h3>
              <p>
                تتبّع الحركة إلى مصدرها، وافهم سبب المطابقة. وما لم يثبت يبقى
                للمراجعة.
              </p>
            </div>
            <div className="tarasuf-feature-stage">
              <FeatureArt kind="evidence" />
            </div>
            <div className="tarasuf-benefit-footer">
              <span className="tarasuf-benefit-note">
                <Link2 size={16} /> المصدر والسبب مع النتيجة
              </span>
            </div>
          </article>
          <article className="tarasuf-benefit tarasuf-benefit-flow" data-reveal>
            <div className="tarasuf-benefit-copy">
              <span className="tarasuf-benefit-label">
                <span /> خطوات مباشرة
              </span>
              <h3>من ملفّين إلى صورة أوضح.</h3>
              <p>
                قراءة ومقارنة ومراجعة في مسار واحد. يوجّه المحرك انتباهك إلى ما
                يحتاج تأكيدك.
              </p>
            </div>
            <div className="tarasuf-feature-stage">
              <FeatureArt kind="workflow" />
            </div>
            <div className="tarasuf-benefit-footer">
              <span className="tarasuf-benefit-note">
                <CheckCheck size={16} /> دون تسجيل أو إعداد تقني
              </span>
            </div>
          </article>
          <article
            className="tarasuf-benefit tarasuf-benefit-assistant"
            data-reveal
          >
            <div className="tarasuf-benefit-copy">
              <span className="tarasuf-benefit-label">
                <span /> شرح يستند إلى الدليل
              </span>
              <h3>مساعد يشرح النتيجة.</h3>
              <p>
                اسأل عمّا لم يتأكد، ولماذا بقي الفرق، وما الذي تراجعه الآن. يشرح
                المساعد أدلة المحرك، ويُبقي قرار المراجعة لك.
              </p>
            </div>
            <div className="tarasuf-feature-stage">
              <FeatureArt kind="assistant" />
            </div>
            <div className="tarasuf-benefit-footer">
              <span className="tarasuf-benefit-note">
                <MessageSquareText size={16} /> من نتائج المحرك، على جهازك
              </span>
            </div>
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
      <div className="tarasuf-privacy-orbit">
        <span />
        <span />
      </div>
      <div className="tarasuf-privacy-device-sculpture">
        <div className="tarasuf-privacy-device-face">
          <div className="tarasuf-privacy-device-top">
            <i />
            <i />
            <i />
            <span>
              <LockKeyhole size={11} /> داخل متصفحك
            </span>
          </div>
          <div className="tarasuf-privacy-device-content">
            <div className="tarasuf-privacy-contained-file">
              <FileText size={22} />
              <i />
              <i />
              <small>ملفّاتك</small>
            </div>
            <div className="tarasuf-privacy-brand-plinth">
              <BrandMark />
            </div>
            <div className="tarasuf-privacy-contained-file">
              <FileCheck2 size={22} />
              <i />
              <i />
              <small>نتائجك</small>
            </div>
          </div>
          <div className="tarasuf-privacy-device-foot">
            <span /> قراءة · مقارنة · تصدير
          </div>
        </div>
        <div className="tarasuf-privacy-device-base" />
      </div>
      <span className="tarasuf-privacy-boundary-label">
        <ShieldCheck size={16} /> بيانات التسوية تبقى ضمن هذه الحدود
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
      >
        <div className="tarasuf-detail-heading" data-reveal>
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
            <li className="tarasuf-process-step" key={title} data-reveal>
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
