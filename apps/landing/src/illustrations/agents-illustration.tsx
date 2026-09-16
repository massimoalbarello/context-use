import chatgpt from '../assets/agents/chatgpt.svg';
import claude from '../assets/agents/claude.svg';
import gemini from '../assets/agents/gemini.svg';
import hermes from '../assets/agents/hermes.png';
import openclaw from '../assets/agents/openclaw.svg';
import { ContextStore } from './context-store';
import { Illustration } from './illustration';

const AGENTS = [
  { logo: claude, position: '0%', delay: '0s' },
  { logo: chatgpt, position: '20%', delay: '-6s' },
  { logo: gemini, position: '40%', delay: '-12s' },
  { logo: openclaw, position: '60%', delay: '-18s' },
  { logo: hermes, position: '80%', delay: '-24s' },
];

export function AgentsIllustration() {
  return (
    <Illustration
      name="agents-illustration"
      description="The Claude, ChatGPT, Gemini, OpenClaw, and Hermes logos orbit the shared context-use store."
    >
      <div className="context-halo" />
      {AGENTS.map(({ logo, position, delay }) => (
        <img
          key={logo}
          className="orbiting-agent"
          src={logo}
          alt=""
          style={{ offsetDistance: position, animationDelay: delay }}
        />
      ))}
      <ContextStore />
    </Illustration>
  );
}
