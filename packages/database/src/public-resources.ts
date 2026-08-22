import type { Pool } from "pg";

export type PublicResource = {
  public_id: string;
  document_id: string | null;
  resource_kind: "page" | "asset";
  created_at: Date | string;
};

export type PublishedPublicResource = Pick<PublicResource, "public_id" | "resource_kind">;

export type PublishedRouteAlias = {
  alias_path: string;
  route_kind: "page" | "directory" | "markdown" | "asset";
  public_id: string;
};

export class PublicResourceRepository {
  constructor(private readonly pool: Pool) {}

  async byDocumentId(documentId: string): Promise<PublicResource | null> {
    const result = await this.pool.query<PublicResource>(
      `SELECT public_id,document_id,resource_kind,created_at
       FROM public_resources
       WHERE document_id=$1`,
      [documentId],
    );
    return result.rows[0] ?? null;
  }

  async published(publicId: string): Promise<PublishedPublicResource | null> {
    const result = await this.pool.query<PublishedPublicResource>(
      `SELECT public_id,resource_kind
       FROM published_public_resources
       WHERE public_id=$1`,
      [publicId],
    );
    return result.rows[0] ?? null;
  }

  async publishedAlias(aliasPath: string): Promise<PublishedRouteAlias | null> {
    const result = await this.pool.query<PublishedRouteAlias>(
      `SELECT alias_path,route_kind,public_id
       FROM published_route_aliases
       WHERE alias_path=$1`,
      [aliasPath],
    );
    return result.rows[0] ?? null;
  }
}
