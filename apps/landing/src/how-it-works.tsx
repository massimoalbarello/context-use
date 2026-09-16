import { MarkGithubIcon } from '@primer/octicons-react';
import { buttonVariants } from '@repo/ui/button';
import { CONTEXT_USE_DEPLOY_URL } from '@repo/ui/context-use-links';
import { ArrowUpRight } from 'lucide-react';
import { AgentsIllustration } from './illustrations/agents-illustration';
import { ContextIllustration } from './illustrations/context-illustration';
import { RevisionsIllustration } from './illustrations/revisions-illustration';
import { SyncIllustration } from './illustrations/sync-illustration';
import { GITHUB_URL } from './links';
import './illustrations/illustrations.css';

const FEATURES = [
  {
    title: 'Sync all your data in one place',
    description:
      'Emails, meetings, messages and more from the services you already use flow into your private store.',
    illustration: SyncIllustration,
  },
  {
    title: 'Connect your favorite agents',
    description:
      'Any agent that supports MCP can read and write your context. Authorize it once and it will grow and learn with you.',
    illustration: AgentsIllustration,
  },
  {
    title: 'Turn raw data into useful context',
    description:
      'The data grounds your agent in the what, but only you can explain the why. Your agents learn from you and help you curate and keep your context up to date.',
    illustration: ContextIllustration,
  },
  {
    title: 'Stay in sync with your agents',
    description:
      'You see everything your agents know about you so you can be sure they stay aligned.',
    illustration: RevisionsIllustration,
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="how-it-works" aria-labelledby="how-it-works-title">
      <div className="how-it-works-inner">
        <div className="how-it-works-intro">
          <div>
            <span className="section-eyebrow">How it works</span>
            <h2 id="how-it-works-title">Your context, shared by you and your agents.</h2>
          </div>
        </div>
        <div className="feature-rows">
          {FEATURES.map(({ title, description, illustration: FeatureIllustration }) => (
            <article className="feature-row" key={title}>
              <FeatureIllustration />
              <div className="feature-copy">
                <h3>{title}</h3>
                <p>{description}</p>
              </div>
            </article>
          ))}
        </div>
        <div className="open-source-section">
          <h3>
            100% open source
            <br />
            and self-hostable.
          </h3>
          <p>It’s your context, and nobody else’s.</p>
          <div className="open-source-actions">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: 'outline', size: 'lg' })}
            >
              <MarkGithubIcon aria-hidden="true" /> Star on GitHub{' '}
              <span className="sr-only">(opens in a new tab)</span>
            </a>
            <a href={CONTEXT_USE_DEPLOY_URL} className={buttonVariants({ size: 'lg' })}>
              Deploy your own <ArrowUpRight aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
