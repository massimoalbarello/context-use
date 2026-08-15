import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { RepublicationReview as Review } from "../types.ts";
import { RepublicationReview, republicationChanged } from "./PublicationDialog.tsx";

const review: Review = {
  published_version_number: 3,
  metadata_changes: [],
  markdown_changes: [{
    before: "Based in Zurich.\n",
    after: "Based in Zurich. Declined the NovaMind offer.\n",
  }],
  queued_versions: [
    {
      version_number: 4,
      commit_message: "Record the NovaMind conversation",
      actor_kind: "mcp",
      actor_subject: "claude-desktop",
      created_at: "2026-08-10T09:00:00.000Z",
    },
    {
      version_number: 5,
      commit_message: "Tidy the opening",
      actor_kind: "dashboard",
      actor_subject: "context-use-owner",
      created_at: "2026-08-11T09:00:00.000Z",
    },
  ],
  queued_versions_complete: true,
};

describe("republication review", () => {
  test("shows what changes for the public and who wrote it", () => {
    const html = renderToStaticMarkup(
      <RepublicationReview review={review} candidateVersionNumber={5} />,
    );

    expect(html).toContain("v3 → v5");
    expect(html).toContain("Declined the NovaMind offer.");
    expect(html).toContain("Record the NovaMind conversation");
    expect(html).toContain("MCP client · claude-desktop");
    expect(html).toContain("You, in the dashboard");
    expect(html).toContain("2 versions written since publication, 1 by an MCP client");
  });

  test("says when the listed versions are not the whole story", () => {
    const html = renderToStaticMarkup(<RepublicationReview
      review={{ ...review, queued_versions_complete: false }}
      candidateVersionNumber={5}
    />);

    expect(html).toContain("older versions were pruned");
  });

  test("states plainly when republishing changes nothing", () => {
    const unchanged: Review = {
      ...review,
      markdown_changes: [],
      queued_versions: [],
    };
    const html = renderToStaticMarkup(
      <RepublicationReview review={unchanged} candidateVersionNumber={3} />,
    );

    expect(html).toContain("identical to the one already public");
    expect(html).not.toContain("written since publication");
    expect(republicationChanged(unchanged)).toBe(false);
  });

  test("shows a moved path as a before and after rather than a body diff", () => {
    const html = renderToStaticMarkup(<RepublicationReview
      review={{
        ...review,
        markdown_changes: [],
        metadata_changes: [{ field: "path", before: "about/intro", after: "about/profile" }],
      }}
      candidateVersionNumber={5}
    />);

    expect(html).toContain("Path");
    expect(html).toContain("about/intro");
    expect(html).toContain("about/profile");
  });

  test("counts any change as a change for the confirmation wording", () => {
    expect(republicationChanged(review)).toBe(true);
    expect(republicationChanged({
      ...review,
      markdown_changes: [],
      metadata_changes: [{ field: "title", before: "Old", after: "New" }],
    })).toBe(true);
  });
});
