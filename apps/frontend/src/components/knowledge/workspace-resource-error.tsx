import { Link } from '@tanstack/react-router';
import { Eyebrow } from '../layout/eyebrow';
import { Button, buttonVariants } from '../ui/button';

type KnowledgeResource = 'page' | 'entity';

const resourceCopy = {
  page: {
    eyebrow: 'Knowledge page',
    collection: 'pages',
    collectionPath: '/pages',
  },
  entity: {
    eyebrow: 'Entity',
    collection: 'entities',
    collectionPath: '/entities',
  },
} as const;

export function WorkspaceResourceError({
  resource,
  error,
  retry,
}: {
  resource: KnowledgeResource;
  error: Error;
  retry: () => void;
}) {
  const copy = resourceCopy[resource];
  const notFound = error.message.toLocaleLowerCase().includes('not found');

  return (
    <div className="mx-auto flex min-h-[32rem] max-w-xl flex-col items-start justify-center px-6 py-16">
      <Eyebrow>{copy.eyebrow}</Eyebrow>
      <h2 className="mt-2 font-semibold text-4xl tracking-tight">
        {notFound ? `${copy.eyebrow} not found` : `Couldn’t load this ${resource}`}
      </h2>
      <p className="mt-3 text-lg text-muted-foreground leading-relaxed">
        {notFound
          ? `This ${resource} may have been removed, or its address may be out of date.`
          : `Something prevented this ${resource} from loading. You can try again or return to your ${copy.collection}.`}
      </p>
      <div className="mt-7 flex flex-wrap gap-2">
        <Link className={buttonVariants({ size: 'lg' })} to={copy.collectionPath} replace>
          Back to {copy.collection}
        </Link>
        {!notFound && (
          <Button variant="outline" size="lg" type="button" onClick={retry}>
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}
