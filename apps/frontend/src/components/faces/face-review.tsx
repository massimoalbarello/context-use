import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { entitiesQueryOptions } from '../../queries/entities';
import { type AnnotationInput, type Face, faceCropUrl } from '../../queries/faces';
import { EntityLink } from '../entities/entity-link';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

function PersonChoices({
  onChoose,
  pending,
}: {
  onChoose: (readableId: string) => void;
  pending: boolean;
}) {
  const [query, setQuery] = useState('');
  const people = useInfiniteQuery(entitiesQueryOptions({ query, entityType: 'person' }));
  return (
    <div className="grid gap-2">
      <Input
        aria-label="Search people"
        placeholder="Search people"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {people.isPending ? (
        <p className="text-muted-foreground text-sm">Loading people…</p>
      ) : people.error ? (
        <p role="alert">Could not load people.</p>
      ) : (
        <ul className="grid max-h-56 list-none gap-1 overflow-y-auto p-0">
          {people.data.pages
            .flatMap((page) => page.items)
            .map((person) => (
              <li key={person.readableId}>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto w-full justify-start whitespace-normal py-2 text-left"
                  disabled={pending}
                  onClick={() => onChoose(person.readableId)}
                >
                  <span>
                    <strong className="block">{person.name}</strong>
                    <span className="block text-muted-foreground text-xs">
                      {person.description}
                    </span>
                  </span>
                </Button>
              </li>
            ))}
        </ul>
      )}
      {people.hasNextPage && (
        <Button
          variant="link"
          disabled={people.isFetchingNextPage}
          onClick={() => void people.fetchNextPage()}
        >
          More people
        </Button>
      )}
      {!people.isPending &&
        !people.error &&
        people.data.pages.every((page) => page.items.length === 0) && (
          <p className="text-muted-foreground text-sm">
            No people found. Create a person entity first.
          </p>
        )}
    </div>
  );
}

export function FaceReview({
  assetReadableId,
  face,
  pending,
  onChange: saveDecision,
}: {
  assetReadableId: string;
  face: Face;
  pending: boolean;
  onChange: (body: AnnotationInput['body']) => void;
}) {
  const [choosing, setChoosing] = useState(!face.entity && face.decision !== 'dismissed');
  function onChange(body: AnnotationInput['body']) {
    setChoosing(false);
    saveDecision(body);
  }
  return (
    <section className="grid gap-4" aria-label="Review face">
      <div className="flex items-center gap-4">
        <img
          src={faceCropUrl({ assetReadableId, faceReadableId: face.readableId })}
          alt="Face being reviewed"
          className="size-20 rounded-lg object-cover"
        />
        <div className="min-w-0 flex-1">
          {face.entity ? (
            <EntityLink entity={face.entity} presentation="inline" />
          ) : (
            <strong>{face.decision === 'dismissed' ? 'Not a face' : 'Unknown person'}</strong>
          )}
        </div>
      </div>
      {face.needsReview && (
        <p className="text-muted-foreground text-sm">
          This region could not be reconciled with the latest detection. Your saved decision is
          preserved.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {face.entity && face.decision === 'automatic' && (
          <Button
            disabled={pending}
            onClick={() =>
              onChange({ decision: 'person', entityReadableId: face.entity!.readableId })
            }
          >
            Confirm person
          </Button>
        )}
        <Button variant="outline" disabled={pending} onClick={() => setChoosing((value) => !value)}>
          Change person
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => onChange({ decision: 'unknown' })}
        >
          Leave unidentified
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => onChange({ decision: 'dismissed' })}
        >
          Not a face
        </Button>
      </div>
      {choosing && (
        <PersonChoices
          pending={pending}
          onChoose={(entityReadableId) => {
            onChange({ decision: 'person', entityReadableId });
            setChoosing(false);
          }}
        />
      )}
    </section>
  );
}
