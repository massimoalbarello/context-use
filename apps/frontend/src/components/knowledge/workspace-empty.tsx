import { Link } from '@tanstack/react-router';
import { Eyebrow } from '../layout/eyebrow';
import { buttonVariants } from '../ui/button';

export function WorkspaceEmpty({
  eyebrow,
  title,
  description,
  createTo,
  createLabel,
}: {
  eyebrow: string;
  title: string;
  description: string;
  createTo: '/entities/new' | '/pages/new' | '/assets/new';
  createLabel: string;
}) {
  return (
    <div className="mx-auto flex min-h-[32rem] max-w-xl flex-col items-start justify-center px-6 py-16">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-2 font-semibold text-4xl tracking-tight">{title}</h2>
      <p className="mt-3 text-lg text-muted-foreground leading-relaxed">{description}</p>
      <Link className={buttonVariants({ size: 'lg', className: 'mt-7' })} to={createTo}>
        {createLabel}
      </Link>
    </div>
  );
}
