import { Asterisk, Check, Command, Minus, Terminal } from 'lucide-react';
import { ContextStore } from './context-store';
import { Illustration } from './illustration';

export function AgentsIllustration() {
  return (
    <Illustration
      name="agents-illustration"
      description="Two AI agents are authorized to use the shared context-use store. A third agent is unauthorized and has no access."
    >
      <div className="context-halo" />
      <svg
        aria-hidden="true"
        className="illustration-connections"
        viewBox="0 0 560 350"
        fill="none"
      >
        <path
          d="M125 96 C230 96 165 175 280 175 M125 260 C230 260 165 175 280 175"
          className="connection-line"
        />
        <path d="M435 175 H280" className="connection-pending" />
      </svg>
      <div className="agent-chip agent-one">
        <Asterisk className="agent-symbol" strokeWidth={1.5} />
        <strong>Agent 01</strong>
        <span className="agent-status authorized">
          <Check /> Authorized
        </span>
      </div>
      <div className="agent-chip agent-two">
        <Command className="agent-symbol" strokeWidth={1.5} />
        <strong>Agent 02</strong>
        <span className="agent-status authorized">
          <Check /> Authorized
        </span>
      </div>
      <div className="agent-chip agent-three">
        <Terminal className="agent-symbol" strokeWidth={1.5} />
        <strong>Agent 03</strong>
        <span className="agent-status unauthorized">
          <Minus /> Unauthorized
        </span>
      </div>
      <ContextStore />
    </Illustration>
  );
}
