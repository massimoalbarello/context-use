import { Check } from 'lucide-react';
import { ContextStore } from './context-store';
import { Illustration } from './illustration';

export function AgentsIllustration() {
  return (
    <Illustration
      name="agents-illustration"
      description="Two authorized agents, a coral sunburst and a blue four-point star, float around their shared context-use store. Green checkmarks show that both are connected."
    >
      <div className="context-halo" />
      <svg
        aria-hidden="true"
        className="illustration-connections"
        viewBox="0 0 560 350"
        fill="none"
      >
        <ellipse
          cx="280"
          cy="175"
          rx="182"
          ry="87"
          transform="rotate(22 280 175)"
          className="agent-orbit"
        />
        <path d="M125 113 Q191 113 280 175 T435 237" className="connection-line" />
        <path d="M125 113 Q191 113 280 175 T435 237" pathLength="100" className="connection-dots" />
      </svg>
      <div className="agent-node agent-one">
        <div className="agent-chip">
          <svg aria-hidden="true" className="agent-symbol" viewBox="0 0 48 48" fill="currentColor">
            <path d="m22 3 5 1-1 13 7-12 4 3-7 12 13-6 2 5-15 5 15 3-1 5-15-4 10 11-4 3-9-12 1 15-5 1-1-16-7 13-4-3 8-13-14 7-2-5 15-5-15-3 1-5 15 4L7 10l4-3 10 13z" />
          </svg>
          <span className="agent-check">
            <Check />
          </span>
        </div>
        <span className="agent-status">Authorized</span>
      </div>
      <div className="agent-node agent-two">
        <div className="agent-chip">
          <svg aria-hidden="true" className="agent-symbol" viewBox="0 0 48 48" fill="currentColor">
            <path d="M24 3C27 17 31 21 45 24 31 27 27 31 24 45 21 31 17 27 3 24 17 21 21 17 24 3Z" />
          </svg>
          <span className="agent-check">
            <Check />
          </span>
        </div>
        <span className="agent-status">Authorized</span>
      </div>
      <ContextStore />
    </Illustration>
  );
}
