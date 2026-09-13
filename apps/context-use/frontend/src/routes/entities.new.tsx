import { buttonVariants } from '@repo/ui/button';
import { cn } from '@repo/ui/class-names';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useRef, useState } from 'react';
import { SELF_ENTITY_TYPE } from '#backend/models/entities/model.ts';
import {
  EntityForm,
  type EntityFormSubmission,
  type EntityFormValues,
} from '../components/entities/entity-form';
import { createEntityImageAsset } from '../components/entities/entity-image-asset';
import { DetailShell } from '../components/knowledge/detail-shell';
import { internalAppPath } from '../lib/internal-app-path';
import { MAIN_KNOWLEDGE_PATH } from '../lib/knowledge-navigation';
import { assetsQueryKey, createAsset } from '../queries/assets';
import { createEntity, entitiesQueryKey, setEntityImage } from '../queries/entities';
import { facesQueryKey } from '../queries/faces';
import { hypermediaQueryKey } from '../queries/hypermedia';
import { createProfile, profileQueryKey, profileQueryOptions } from '../queries/profile';

const EMPTY_ENTITY: EntityFormValues = { name: '', description: '', entityType: null, image: null };

export const Route = createFileRoute('/entities/new')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: internalAppPath(search.redirect),
  }),
  component: NewEntityRoute,
});

function NewEntityRoute() {
  const navigate = useNavigate();
  const { profile } = Route.useRouteContext();
  const { redirect: redirectTo } = Route.useSearch();
  const queryClient = useQueryClient();
  const [createdReadableId, setCreatedReadableId] = useState<string | null>(null);
  const uploadedImage = useRef<{ file: File; readableId: string } | null>(null);
  const creation = useMutation({
    mutationFn: async ({ image, ...values }: EntityFormSubmission) => {
      let assetReadableId: string | undefined;
      if (image instanceof File) {
        if (uploadedImage.current?.file !== image) {
          const asset = await createEntityImageAsset({
            entityName: values.name,
            file: image,
            createAsset,
          });
          uploadedImage.current = { file: image, readableId: asset.readableId };
          await queryClient.invalidateQueries({ queryKey: assetsQueryKey });
        }
        assetReadableId = uploadedImage.current.readableId;
      } else {
        assetReadableId = image?.readableId;
      }
      let readableId = createdReadableId;
      if (!readableId) {
        readableId = profile
          ? (await createEntity(values)).readableId
          : (await createProfile(values)).selfEntity.readableId;
        setCreatedReadableId(readableId);
      }
      if (assetReadableId) {
        await setEntityImage({ readableId, assetReadableId });
      }
      return readableId;
    },
    onSuccess: async (readableId) => {
      await Promise.all(
        [entitiesQueryKey, assetsQueryKey, facesQueryKey, hypermediaQueryKey, profileQueryKey].map(
          (queryKey) => queryClient.invalidateQueries({ queryKey }),
        ),
      );
      await queryClient.fetchQuery(profileQueryOptions);
      if (profile) {
        await navigate({ to: '/entities/$id', params: { id: readableId } });
      } else {
        await navigate({ href: redirectTo ?? MAIN_KNOWLEDGE_PATH });
      }
    },
  });
  const content = (
    <>
      <header className="grid gap-1">
        <h1 className="font-semibold text-2xl tracking-tight">
          {profile ? 'New entity' : 'Create your first entity'}
        </h1>
        <p className="text-muted-foreground text-sm">
          {profile
            ? 'The permanent address will be derived from the entity’s name.'
            : 'Start with yourself. This entity anchors your workspace and can be mentioned like any other.'}
        </p>
      </header>
      <EntityForm
        initialValues={profile ? EMPTY_ENTITY : { ...EMPTY_ENTITY, entityType: SELF_ENTITY_TYPE }}
        entityTypeReadOnly={!profile}
        pending={creation.isPending}
        identitySaved={createdReadableId !== null}
        error={creation.error}
        submitLabel={profile ? 'Create entity' : 'Create first entity'}
        onSubmit={(values) => creation.mutate(values)}
      />
    </>
  );

  if (!profile) {
    return (
      <main className="relative grid min-h-full w-full content-center px-5 pt-24 pb-12 md:px-8">
        <Link
          className={cn(
            buttonVariants({ variant: 'ghost' }),
            'absolute top-5 left-5 md:top-7 md:left-8',
          )}
          to="/setup"
          search={{ redirect: redirectTo }}
        >
          <ArrowLeft aria-hidden="true" />
          Back to agent bootstrap
        </Link>
        <div className="mx-auto grid w-full max-w-2xl gap-5">{content}</div>
      </main>
    );
  }

  return <DetailShell className="w-full max-w-2xl gap-5">{content}</DetailShell>;
}
