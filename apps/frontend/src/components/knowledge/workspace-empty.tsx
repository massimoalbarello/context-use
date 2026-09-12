import { Link } from '@tanstack/react-router';
import { workspaceAccess } from '../../lib/workspace-access';
import { Eyebrow } from '../layout/eyebrow';
import { buttonVariants } from '../ui/button';

type WorkspaceEmptyAction =
  | {
      createTo: '/entities/new' | '/pages/new' | '/assets/new';
      createLabel: string;
    }
  | { createTo?: never; createLabel?: never };

type WorkspaceEmptyProps = WorkspaceEmptyAction & {
  eyebrow: string;
  title: string;
  description: string;
};

export function WorkspaceEmpty({
  eyebrow,
  title,
  description,
  createTo,
  createLabel,
}: WorkspaceEmptyProps) {
  return (
    <div className="mx-auto flex min-h-[32rem] max-w-xl flex-col items-start justify-center px-6 py-16">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-2 font-semibold text-4xl tracking-tight">{title}</h2>
      <p className="mt-3 text-lg text-muted-foreground leading-relaxed">{description}</p>
      {workspaceAccess.canWrite && createTo && createLabel && (
        <Link className={buttonVariants({ size: 'lg', className: 'mt-7' })} to={createTo}>
          {createLabel}
        </Link>
      )}
    </div>
  );
}
