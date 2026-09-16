import { MousePointer2 } from 'lucide-react';
import { Illustration } from './illustration';

export function RevisionsIllustration() {
  return (
    <Illustration
      name="revisions-illustration"
      description="An agent drafts a trip to Sintra. Your cursor changes the train from morning to afternoon, then updates the plan: Maya is joining, but Alex couldn't make it. Both cursors share the same document."
    >
      <div className="revision-document">
        <h4 className="revision-heading">A day in Sintra</h4>
        <p className="revision-prose">
          Take the{' '}
          <span className="revision-word revision-time">
            <span className="revision-word-original">morning</span>
            <span className="revision-word-updated">afternoon</span>
          </span>{' '}
          train to Sintra and wander through the palace gardens. Find a quiet café before heading
          back to Lisbon.
        </p>
        <p className="revision-prose revision-guests">
          <span className="revision-word revision-people">
            <span className="revision-word-original">
              Maya and Alex are joining us for the day.
            </span>
            <span className="revision-word-updated">
              Maya is joining us. Alex couldn’t make it.
            </span>
          </span>
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
    </Illustration>
  );
}
