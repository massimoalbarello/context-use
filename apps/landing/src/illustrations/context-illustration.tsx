import { ArrowRight, CalendarDays, Mail, MessageCircle } from 'lucide-react';
import { Illustration } from './illustration';

function TripPhoto({ recognized = false }: { recognized?: boolean }) {
  return (
    <div className="trip-photo">
      <img src="/trip-friends.jpg" alt="" width="360" height="240" loading="lazy" />
      {recognized && (
        <>
          <span className="face-tag face-maya">
            <span>Maya</span>
          </span>
          <span className="face-tag face-alex">
            <span>Alex</span>
          </span>
        </>
      )}
    </div>
  );
}

export function ContextIllustration() {
  return (
    <Illustration
      name="context-illustration"
      description="Flight details, travel messages, and a photo become a Lisbon trip plan for September 12–18. Maya and Alex are mentioned in the plan and both faces are identified in the photo."
    >
      <div className="trip-sources">
        <span className="illustration-eyebrow">The pieces</span>
        <div className="trip-fragment">
          <Mail />
          <span>
            <strong>Flights to Lisbon</strong>
            <small>12–18 September</small>
          </span>
        </div>
        <div className="trip-fragment">
          <MessageCircle />
          <span>
            <strong>Let’s take the train</strong>
            <small>Maya · Trip chat</small>
          </span>
        </div>
        <div className="trip-fragment">
          <CalendarDays />
          <span>
            <strong>A day in Sintra?</strong>
            <small>Ideas for our trip</small>
          </span>
        </div>
        <TripPhoto />
      </div>
      <ArrowRight className="trip-transform" strokeWidth={1.25} />
      <div className="trip-page">
        <span className="illustration-eyebrow">The context</span>
        <h4>Our week in Lisbon</h4>
        <span className="trip-date">12–18 September</span>
        <p>
          A slower trip with <mark>Maya</mark> and <mark>Alex</mark>. Time for the coast, local
          food, and a day in Sintra.
        </p>
        <TripPhoto recognized />
        <div className="page-lines">
          <span />
          <span />
        </div>
      </div>
    </Illustration>
  );
}
