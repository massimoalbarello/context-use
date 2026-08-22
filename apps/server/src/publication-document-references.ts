import { extractDocumentLinks } from "@context-use/database";

export type PublicationDocumentReference = {
  kind: "page" | "asset" | "record" | "document";
  id: string;
  label: string;
  path: string | null;
  public: boolean;
};

type PublicationReferenceLookups = {
  pages: {
    metadata(id: string): Promise<{
      title: string;
      current_path: string;
      published_version_id: string | null;
    } | null>;
  };
  assets: {
    get(id: string): Promise<{
      filename: string;
      current_path: string;
      public_path: string | null;
    } | null>;
  };
  records: {
    metadata(id: string): Promise<{
      integration: string;
      model: string;
    } | null>;
  };
};

/**
 * Review canonical links by their resolved operational representation. The URI
 * intentionally does not declare a kind, and embedded plus ordinary links to
 * the same target appear once in the owner's publication review.
 */
export async function publicationDocumentReferences(input: {
  markdown: string;
  publishingPage: { id: string; title: string; path: string };
  lookups: PublicationReferenceLookups;
}): Promise<PublicationDocumentReference[]> {
  const { markdown, publishingPage, lookups } = input;
  return Promise.all(extractDocumentLinks(markdown).map(async (id) => {
    if (id === publishingPage.id) {
      return {
        kind: "page" as const,
        id,
        label: publishingPage.title,
        path: publishingPage.path,
        public: true,
      };
    }

    const [page, asset, record] = await Promise.all([
      lookups.pages.metadata(id),
      lookups.assets.get(id),
      lookups.records.metadata(id),
    ]);
    const matchCount = Number(page !== null) + Number(asset !== null) + Number(record !== null);
    if (matchCount !== 1) {
      return {
        kind: "document" as const,
        id,
        label: matchCount ? "Ambiguous document identity" : "Missing document",
        path: null,
        public: false,
      };
    }
    if (page) {
      return {
        kind: "page" as const,
        id,
        label: page.title,
        path: page.current_path,
        public: Boolean(page.published_version_id),
      };
    }
    if (asset) {
      return {
        kind: "asset" as const,
        id,
        label: asset.filename,
        path: asset.current_path,
        public: Boolean(asset.public_path),
      };
    }
    return {
      kind: "record" as const,
      id,
      label: `${record!.integration} ${record!.model} record`,
      path: null,
      public: false,
    };
  }));
}
