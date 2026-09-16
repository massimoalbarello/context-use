import { ArrowDown, Check, MessageCircle } from 'lucide-react';
import { Illustration } from './illustration';

export function RevisionsIllustration() {
  return (
    <Illustration
      name="revisions-illustration"
      description="An agent drafts a plan for a morning train to Sintra. You add new information that Alex arrives at noon. The agent updates the shared plan to take the afternoon train together, with the revision history visible."
    >
      <div className="revision-document">
        <div className="revision-heading">
          <strong>A day in Sintra</strong>
          <span>Trip plan</span>
        </div>
        <div className="revision-original">
          <span className="revision-author">Agent · First plan</span>
          <p>Take the morning train to Sintra.</p>
        </div>
        <div className="revision-update">
          <MessageCircle />
          <div>
            <span className="revision-author">You · New information</span>
            <p>Alex arrives at noon. Let’s go together.</p>
          </div>
        </div>
        <ArrowDown className="revision-arrow" />
        <div className="revision-current">
          <span className="revision-author">
            <Check /> Agent · Updated plan
          </span>
          <p>Take the afternoon train to Sintra together.</p>
        </div>
      </div>
      <div className="revision-timeline">
        <span>
          Agent <small>Drafts</small>
        </span>
        <span>
          You <small>Adds context</small>
        </span>
        <span>
          Agent <small>Refines</small>
        </span>
      </div>
    </Illustration>
  );
}
