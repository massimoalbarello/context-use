import { CalendarDays, FileText, Image, Mail, MessageCircle } from 'lucide-react';
import { ContextStore } from './context-store';
import { Illustration } from './illustration';

const SOURCES = [
  { label: 'Emails', icon: Mail, position: 'source-mail', path: 'M88 75 C170 75 155 170 280 175' },
  { label: 'Messages', icon: MessageCircle, position: 'source-chat', path: 'M75 175 H280' },
  {
    label: 'Meetings',
    icon: CalendarDays,
    position: 'source-calendar',
    path: 'M88 275 C170 275 155 180 280 175',
  },
  {
    label: 'Documents',
    icon: FileText,
    position: 'source-document',
    path: 'M472 100 C385 100 405 170 280 175',
  },
  {
    label: 'Photos',
    icon: Image,
    position: 'source-photo',
    path: 'M472 250 C385 250 405 180 280 175',
  },
];

export function SyncIllustration() {
  return (
    <Illustration
      name="sync-illustration"
      description="Emails, messages, meetings, documents, and photos flow into one private context-use store."
    >
      <div className="context-halo" />
      <svg
        aria-hidden="true"
        className="illustration-connections"
        viewBox="0 0 560 350"
        fill="none"
      >
        {SOURCES.map(({ label, path }) => (
          <g key={label}>
            <path d={path} className="connection-line" />
            <path d={path} pathLength="100" className="connection-dots" />
          </g>
        ))}
      </svg>
      {SOURCES.map(({ label, icon: Icon, position }) => (
        <div className={`source-node ${position}`} key={label}>
          <span className="source-icon">
            <Icon strokeWidth={1.5} />
          </span>
          <span>{label}</span>
        </div>
      ))}
      <ContextStore />
    </Illustration>
  );
}
