import { MousePointer2 } from 'lucide-react';
import { Illustration } from './illustration';

export function RevisionsIllustration() {
  return (
    <Illustration
      name="revisions-illustration"
      description="An agent drafts a morning train to Sintra in a shared trip plan. Your cursor adds the latest timing, updating morning to afternoon. The agent and you cursors and revision history show how you keep the same context up to date."
    >
      <div className="revision-document">
        <div className="revision-heading">
          <strong>A day in Sintra</strong>
          <span>Shared trip plan</span>
        </div>
        <p className="revision-prose">
          Take the{' '}
          <span className="revision-word">
            <span className="revision-word-original">morning</span>
            <span className="revision-word-updated">afternoon</span>
          </span>{' '}
          train to Sintra.
          <br />
          Wander through the palace gardens,
          <br />
          then find a quiet spot for coffee.
          <br />
          Maya and Alex are coming along.
        </p>
        <div className="collaboration-cursor cursor-agent">
          <MousePointer2 />
          <span>agent</span>
        </div>
        <div className="collaboration-cursor cursor-you">
          <MousePointer2 />
          <span>you</span>
        </div>
      </div>
      <div className="revision-timeline">
        <span>
          Agent <small>Drafted the plan</small>
        </span>
        <span>
          You <small>Added new context</small>
        </span>
      </div>
    </Illustration>
  );
}
