import {
  ArrowRight,
  AudioLines,
  Check,
  CheckCheck,
  FileText,
  LoaderCircle,
  Play,
  Search,
} from 'lucide-react';
import '../landing.css';

type LandingPageProps = {
  onEnterWorkspace: () => void;
  onExploreDemo: () => void;
  busy: boolean;
};

function LandingBrand() {
  return (
    <span className="landing-brand">
      <span className="landing-brand-icon brand-mark" aria-hidden="true"><i /><i /><i /></span>
      <span>sidekick<span className="landing-brand-period">.</span></span>
    </span>
  );
}

function MeetingIllustration() {
  return (
    <div className="landing-product" aria-hidden="true">
      <div className="landing-product-header">
        <span><AudioLines size={17} strokeWidth={1.6} /> Meeting workspace</span>
        <span className="landing-product-live"><i /> Working alongside your team</span>
      </div>
      <div className="landing-product-body">
        <div className="landing-product-panel">
          <div className="landing-product-label"><Search size={16} /> Research</div>
          <h3>Answers with source links</h3>
          <div className="landing-preview-lines"><i /><i /><i /></div>
          <div className="landing-preview-sources"><span><Check size={11} /> Source 01</span><span><Check size={11} /> Source 02</span></div>
        </div>
        <div className="landing-product-panel landing-product-draft">
          <div className="landing-product-label"><FileText size={16} /> Drafts</div>
          <h3>Documents, slides, and sheets</h3>
          <div className="landing-preview-document">
            <div className="landing-preview-document-heading"><FileText size={15} /><span>First draft</span><Check size={13} /></div>
            <div className="landing-preview-lines"><i /><i /><i /></div>
          </div>
        </div>
        <div className="landing-product-panel">
          <div className="landing-product-label"><CheckCheck size={16} /> Decisions</div>
          <h3>Agreements and next steps</h3>
          <div className="landing-preview-checklist">
            <span><Check size={11} /><i /></span>
            <span><Check size={11} /><i /></span>
            <span><span className="landing-preview-unchecked" /><i /></span>
          </div>
        </div>
      </div>
      <div className="landing-product-footer">
        <span className="landing-product-listening"><span><i /><i /><i /><i /><i /><i /><i /></span> Listening to the conversation</span>
        <span>Your team makes the decisions</span>
      </div>
    </div>
  );
}

export function LandingPage({ onEnterWorkspace, onExploreDemo, busy }: LandingPageProps) {
  return (
    <div className="landing-page">
      <header className="landing-header">
        <div className="landing-header-inner">
          <LandingBrand />
          <button type="button" className="landing-workspace-link" onClick={onEnterWorkspace}>
            View your workspace <ArrowRight size={15} />
          </button>
        </div>
      </header>

      <main className="landing-main">
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-hero-copy">
            <p className="landing-eyebrow"><AudioLines size={15} /> An AI teammate for team meetings</p>
            <h1 id="landing-title">You talk it through.<br /><span>Sidekick gets to work.</span></h1>
            <p className="landing-description">
              As your team discusses an idea, Sidekick researches the questions
              and builds the first drafts. Open the research, review a proposal,
              or change direction while the conversation is still happening.
            </p>
            <div className="landing-actions">
              <button type="button" className="button primary landing-start-button" onClick={onEnterWorkspace}>
                Start now <ArrowRight size={16} />
              </button>
              <button type="button" className="button secondary landing-demo-button" onClick={onExploreDemo} disabled={busy} aria-busy={busy}>
                {busy ? <LoaderCircle size={15} className="spin" /> : <Play size={14} />} Explore a demo
              </button>
            </div>
          </div>
          <MeetingIllustration />
        </section>

        <section className="landing-features" aria-label="What Sidekick brings to a meeting">
          <article className="landing-feature">
            <div className="landing-feature-top"><Search size={20} strokeWidth={1.6} /><span>01</span></div>
            <h2>Research questions as they come up.</h2>
            <p>Sidekick looks up relevant information while you talk, with source links your team can check.</p>
          </article>
          <article className="landing-feature">
            <div className="landing-feature-top"><FileText size={20} strokeWidth={1.6} /><span>02</span></div>
            <h2>Review drafts during the meeting.</h2>
            <p>Open a proposal, presentation, or planning sheet. Add feedback as you talk to help Sidekick update it.</p>
          </article>
          <article className="landing-feature">
            <div className="landing-feature-top"><CheckCheck size={20} strokeWidth={1.6} /><span>03</span></div>
            <h2>Keep decisions and next steps clear.</h2>
            <p>Review what your team agreed, what still needs an answer, and which follow-ups have an owner.</p>
          </article>
        </section>
      </main>

      <footer className="landing-footer">
        <LandingBrand />
        <span>Discuss. Research. Draft.</span>
        <span>Your team makes the decisions.</span>
      </footer>
    </div>
  );
}
