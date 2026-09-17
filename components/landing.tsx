import { useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Files,
  ScanLine,
  FileCheck2,
  LockKeyhole,
} from 'lucide-react';
import { BrandMark, DisplayHeading } from '@/components/brand';
import { DocumentScene } from '@/components/document-scene';

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
            <LockKeyhole size={14} /> ملفاتك تبقى على جهازك. لا تسجيل، لا تعقيد.
          </p>
        </div>
        <DocumentScene />
      </div>
      <div className="hero-bottomline">
        <span>من البيانات إلى الوضوح</span>
        <span dir="ltr">FROM DATA TO CLARITY</span>
      </div>
    </div>
  );
}

export function LandingDetails() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Content stays visible if the observer is unavailable or motion is reduced.
    if (
      !root.current ||
      !('IntersectionObserver' in window) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-revealed');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 },
    );
    const elements = root.current.querySelectorAll('[data-reveal]');
    elements.forEach((el) => {
      el.classList.add('reveal-ready');
      observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);
  return (
    <div className="landing-details" ref={root}>
      <section
        className="process-section"
        id="how-it-works"
        aria-labelledby="process-title"
        data-reveal
      >
        <div className="support-heading">
          <span className="section-index" dir="ltr">
            01 / THE PROCESS
          </span>
          <h2 id="process-title">
            <DisplayHeading id="process" />
          </h2>
          <p>من ملفّين مختلفين إلى ورقة عمل يمكنك الرجوع إليها.</p>
        </div>
        <div className="process-grid">
          {[
            {
              icon: Files,
              title: 'أضف الملفين',
              text: 'كشف المورد وتقريرك المحاسبي. تُقرأ البيانات محليًا، ويُطلب منك استكمال ما ينقص فقط.',
              number: '01',
            },
            {
              icon: ScanLine,
              title: 'افهم كل فرق',
              text: 'مطابقات لها دليل، وفروق ظاهرة، وحالات تحتاج قرارك. تستطيع مراجعة مصدر كل حركة.',
              number: '02',
            },
            {
              icon: FileCheck2,
              title: 'احتفظ بالتفاصيل',
              text: 'صدّر ورقة Excel تجمع النتائج والمصادر وملاحظاتك، لتكمل المراجعة أنت وفريقك.',
              number: '03',
            },
          ].map(({ icon: Icon, title, text, number }) => (
            <article className="process-item" key={number}>
              <div className="process-top">
                <Icon size={25} strokeWidth={1.5} />
                <span dir="ltr">{number}</span>
              </div>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>
      <section
        className="privacy-section"
        id="privacy"
        aria-labelledby="privacy-title"
        data-reveal
      >
        <div className="privacy-emblem" aria-hidden="true">
          <BrandMark />
          <span />
          <span />
        </div>
        <div className="privacy-copy">
          <span className="section-index" dir="ltr">
            02 / LOCAL BY DESIGN
          </span>
          <h2 id="privacy-title">
            <DisplayHeading id="privacy" />
          </h2>
          <p>
            القراءة والمقارنة والتصدير تتم داخل متصفحك. لا نرسل الملفات أو بيانات
            التسوية إلى خادم معالجة، ولا نستخدم أدوات تتبّع داخل التطبيق.
          </p>
          <div className="privacy-points">
            <span>
              <LockKeyhole size={15} /> معالجة محلية
            </span>
            <span>دون حساب</span>
            <span>دون مفاتيح API</span>
          </div>
        </div>
      </section>
    </div>
  );
}
