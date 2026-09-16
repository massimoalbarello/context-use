import { Check } from 'lucide-react';
import { ContextStore } from './context-store';
import { Illustration } from './illustration';

export function AgentsIllustration() {
  return (
    <Illustration
      name="agents-illustration"
      description="Two authorized AI agents, represented by a sunburst and an interlocking-loop symbol, move gently around the shared context-use store."
    >
      <div className="context-halo" />
      <svg
        aria-hidden="true"
        className="illustration-connections"
        viewBox="0 0 560 350"
        fill="none"
      >
        <path
          d="M129 111 C205 111 185 175 280 175 M431 227 C355 227 375 175 280 175"
          className="connection-line"
        />
      </svg>
      <div className="agent-node agent-one">
        <div className="agent-chip">
          <svg
            aria-hidden="true"
            className="agent-symbol agent-sunburst"
            viewBox="0 0 48 48"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          >
            <path d="M24 6v11m0 14v11M6 24h11m14 0h11M11 11l8 8m10 10 8 8M11 37l8-8m10-10 8-8M17 7l4 10m6 14 4 10M7 31l10-4m14-6 10-4M7 17l10 4m14 6 10 4M17 41l4-10m6-14 4-10" />
          </svg>
        </div>
        <span className="agent-status">
          <Check /> Authorized
        </span>
      </div>
      <div className="agent-node agent-two">
        <div className="agent-chip">
          <svg
            aria-hidden="true"
            className="agent-symbol agent-knot"
            viewBox="0 0 48 48"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M24 8c-9-6-20 7-12 15l12 7 8-5V15Z" />
            <path d="M24 8c-9-6-20 7-12 15l12 7 8-5V15Z" transform="rotate(60 24 24)" />
            <path d="M24 8c-9-6-20 7-12 15l12 7 8-5V15Z" transform="rotate(120 24 24)" />
            <path d="M24 8c-9-6-20 7-12 15l12 7 8-5V15Z" transform="rotate(180 24 24)" />
            <path d="M24 8c-9-6-20 7-12 15l12 7 8-5V15Z" transform="rotate(240 24 24)" />
            <path d="M24 8c-9-6-20 7-12 15l12 7 8-5V15Z" transform="rotate(300 24 24)" />
          </svg>
        </div>
        <span className="agent-status">
          <Check /> Authorized
        </span>
      </div>
      <ContextStore />
    </Illustration>
  );
}
