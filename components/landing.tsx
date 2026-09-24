import { useEffect, useRef, type RefObject } from 'react';
import {
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
import { ForwardArrow, ForwardDownArrow } from '@/components/direction';
import { useI18n } from '@/lib/i18n/context';
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
  const { t } = useI18n();
  const l = t.landing;
  return (
    <div className="landing-intro" id="top">
      <div className="hero-inner">
        <div className="hero-copy">
          <div className="hero-eyebrow">
            <span /> {l.eyebrow}
          </div>
          <h1 className="hero-title">
            <DisplayHeading id="heroLine1" />
            <DisplayHeading id="heroLine2" />
          </h1>
          <p className="hero-description">
            {l.descriptionLine1}
            <br />
            {l.descriptionLine2}
          </p>
          <div className="hero-actions">
            <a href="#reconciliation" className="primary-link">
              {l.start} <ForwardArrow size={19} />
            </a>
            <a href="#how-it-works" className="quiet-link">
              {l.howItWorks}
            </a>
          </div>
          <p className="hero-privacy">
            <LockKeyhole size={14} /> {l.privacyNote}
          </p>
        </div>
        <DocumentScene />
      </div>
      <div className="hero-bottomline">
        <span>{l.bottomline[0]}</span>
        <span>{l.bottomline[1]}</span>
      </div>
    </div>
  );
}

export function LandingBenefits() {
  const { t } = useI18n();
  const b = t.landing.benefits;
  const root = useRef<HTMLDivElement>(null);
  useLandingReveal(root);
  return (
    <div className="tarasuf-benefits-wrap" ref={root}>
      <section className="tarasuf-benefits" aria-labelledby="benefits-title">
        <div className="tarasuf-benefits-heading" data-reveal>
          <span className="tarasuf-section-kicker">{b.kicker}</span>
          <h2 id="benefits-title">{b.title}</h2>
          <p>{b.intro}</p>
        </div>
        <div className="tarasuf-benefits-strip">
          <article
            className="tarasuf-benefit tarasuf-benefit-local"
            data-reveal
          >
            <div className="tarasuf-benefit-copy">
              <span className="tarasuf-benefit-label">
                <span /> {b.local.label}
              </span>
              <h3>{b.local.title}</h3>
              <p>{b.local.text}</p>
            </div>
            <div className="tarasuf-feature-stage">
              <FeatureArt kind="privacy" />
            </div>
            <div className="tarasuf-benefit-footer">
              <a href="#privacy">
                {b.local.link} <ForwardArrow size={16} />
              </a>
              <span className="tarasuf-feature-seal" aria-hidden="true">
                <ShieldCheck size={14} /> {b.local.seal}
              </span>
            </div>
          </article>
          <article
            className="tarasuf-benefit tarasuf-benefit-evidence"
            data-reveal
          >
            <div className="tarasuf-benefit-copy">
              <span className="tarasuf-benefit-label">
                <span /> {b.evidence.label}
              </span>
              <h3>{b.evidence.title}</h3>
              <p>{b.evidence.text}</p>
            </div>
            <div className="tarasuf-feature-stage">
              <FeatureArt kind="evidence" />
            </div>
            <div className="tarasuf-benefit-footer">
              <span className="tarasuf-benefit-note">
                <Link2 size={16} /> {b.evidence.note}
              </span>
            </div>
          </article>
          <article className="tarasuf-benefit tarasuf-benefit-flow" data-reveal>
            <div className="tarasuf-benefit-copy">
              <span className="tarasuf-benefit-label">
                <span /> {b.flow.label}
              </span>
              <h3>{b.flow.title}</h3>
              <p>{b.flow.text}</p>
            </div>
            <div className="tarasuf-feature-stage">
              <FeatureArt kind="workflow" />
            </div>
            <div className="tarasuf-benefit-footer">
              <span className="tarasuf-benefit-note">
                <CheckCheck size={16} /> {b.flow.note}
              </span>
            </div>
          </article>
          <article
            className="tarasuf-benefit tarasuf-benefit-assistant"
            data-reveal
          >
            <div className="tarasuf-benefit-copy">
              <span className="tarasuf-benefit-label">
                <span /> {b.assistant.label}
              </span>
              <h3>{b.assistant.title}</h3>
              <p>{b.assistant.text}</p>
            </div>
            <div className="tarasuf-feature-stage">
              <FeatureArt kind="assistant" />
            </div>
            <div className="tarasuf-benefit-footer">
              <span className="tarasuf-benefit-note">
                <MessageSquareText size={16} /> {b.assistant.note}
              </span>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}

function ProcessVisual({ step }: { step: number }) {
  const { t } = useI18n();
  const p = t.landing.process;
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
            <small>{p.supplier}</small>
          </span>
          <span>
            <FileSpreadsheet size={22} strokeWidth={1.4} />
            <i />
            <i />
            <small>{p.ledger}</small>
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
            <b>{p.confirmed}</b>
            <Check size={12} />
          </span>
          <span>
            <i className="tarasuf-evidence-difference" />
            <b>{p.difference}</b>
            <span>≠</span>
          </span>
          <span>
            <i className="tarasuf-evidence-review" />
            <b>{p.review}</b>
            <span>…</span>
          </span>
        </div>
      )}
      {step === 3 && (
        <div className="tarasuf-process-workpaper">
          <span>
            <FileCheck2 size={20} strokeWidth={1.5} />
            <b>{p.workpaper}</b>
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
          <small>{p.workpaperParts}</small>
        </div>
      )}
    </div>
  );
}

function PrivacyBoundary() {
  const { t } = useI18n();
  const p = t.landing.privacy;
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
              <LockKeyhole size={11} /> {p.browser}
            </span>
          </div>
          <div className="tarasuf-privacy-device-content">
            <div className="tarasuf-privacy-contained-file">
              <FileText size={22} />
              <i />
              <i />
              <small>{p.files}</small>
            </div>
            <div className="tarasuf-privacy-brand-plinth">
              <BrandMark />
            </div>
            <div className="tarasuf-privacy-contained-file">
              <FileCheck2 size={22} />
              <i />
              <i />
              <small>{p.results}</small>
            </div>
          </div>
          <div className="tarasuf-privacy-device-foot">
            <span /> {p.steps}
          </div>
        </div>
        <div className="tarasuf-privacy-device-base" />
      </div>
      <span className="tarasuf-privacy-boundary-label">
        <ShieldCheck size={16} /> {p.boundary}
      </span>
    </div>
  );
}

export function LandingDetails() {
  const { t } = useI18n();
  const l = t.landing;
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
          <span className="tarasuf-section-kicker">{l.howItWorks}</span>
          <h2 id="process-title">
            <DisplayHeading id="process" />
          </h2>
          <p>{l.process.intro}</p>
        </div>
        <ol className="tarasuf-process-track">
          {l.process.steps.map(({ number, title, text, detail }, index) => (
            <li className="tarasuf-process-step" key={index} data-reveal>
              <div className="tarasuf-process-step-top">
                <span>{number}</span>
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
          <span className="tarasuf-section-kicker">{l.privacy.kicker}</span>
          <h2 id="privacy-title">
            <DisplayHeading id="privacy" />
          </h2>
          <p>{l.privacy.text}</p>
          <div className="tarasuf-privacy-assurances">
            {l.privacy.assurances.map((assurance, index) => (
              <span key={index}>
                <Check size={14} /> {assurance}
              </span>
            ))}
          </div>
          <a className="tarasuf-detail-link" href="#privacy-details">
            {l.privacy.link} <ForwardDownArrow size={17} />
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
          <span className="tarasuf-section-kicker">{l.limits.kicker}</span>
          <h2 id="privacy-formal-title">{l.limits.title}</h2>
          <p>{l.limits.intro}</p>
        </div>
        <div className="tarasuf-privacy-disclosures">
          {/* Keyed by position, so an open answer stays open when the
              language changes. */}
          {l.limits.items.map(({ question, answer }, index) => (
            <details key={index}>
              <summary>
                {question}
                <ChevronDown size={17} />
              </summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
