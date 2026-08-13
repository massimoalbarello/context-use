import { describe, expect, test } from "bun:test";
import type { KnowledgeSnapshot, PageSnapshot } from "../snapshot.ts";
import { buildKnowledgeGraph, candidateChanged, candidateLinksTo, termsScore } from "./graph.ts";
import { resolveStorySubjects } from "./resolver.ts";
import { scoreStoryTurn } from "./scoring.ts";
import { storySessionInternals } from "./session.ts";
import {
  created,
  exists,
  durableSubject,
  linked,
  meeting,
  organization,
  person,
  story,
  timelineEvent,
  type TurnToolActivity,
} from "./types.ts";

const page = (input: {
  id: string;
  directoryId: string;
  path: string;
  title: string;
  body: string;
  version?: number;
}): PageSnapshot => ({
  id: input.id,
  parentDirectoryId: input.directoryId,
  path: input.path,
  version: input.version ?? 1,
  title: input.title,
  summary: `${input.title} summary.`,
  body: input.body,
});

function fixture(input: { meetingPath?: string; meetingVersion?: number; duplicate?: boolean } = {}): KnowledgeSnapshot {
  const meetingPath = input.meetingPath ?? "meetings/1998/03/1998-03-12_blue-review";
  const directories = [
    { id: "people-jony", path: "people/jonathan-ive", version: 1, title: "Jonathan Ive", summary: "Apple designer." },
    { id: "company-apple", path: "companies/apple-computer", version: 1, title: "Apple Computer", summary: "Computer company." },
    { id: "meeting-review", path: meetingPath, version: 1, title: "Consumer desktop review", summary: "iMac design review." },
    ...(input.duplicate ? [{
      id: "meeting-copy", path: "meetings/1998/03/1998-03-12_imac-copy", version: 1,
      title: "iMac review copy", summary: "The same iMac design review.",
    }] : []),
  ];
  const meetingBody = `Jony met Steve at [[companies/apple-computer/intro|Apple]] about iMac.

[[people/jonathan-ive/intro|Jony Ive]] kept Bondi blue and USB.`;
  const pages = [
    page({ id: "jony-intro", directoryId: "people-jony", path: "people/jonathan-ive/intro", title: "Jony Ive", body: "Designer at [[companies/apple-computer/intro|Apple]]." }),
    page({ id: "jony-timeline", directoryId: "people-jony", path: "people/jonathan-ive/timeline", title: "Jony timeline", body: `## 1998\n\n### March\n\n- **12 March** — [[${meetingPath}/intro|Design review]] — kept Bondi blue and USB.` }),
    page({ id: "apple-intro", directoryId: "company-apple", path: "companies/apple-computer/intro", title: "Apple Computer", body: "Works with [[people/jonathan-ive/intro|Jony Ive]]." }),
    page({ id: "review-intro", directoryId: "meeting-review", path: `${meetingPath}/intro`, title: "Consumer desktop review", body: meetingBody, version: input.meetingVersion }),
    ...(input.duplicate ? [page({
      id: "copy-intro", directoryId: "meeting-copy", path: "meetings/1998/03/1998-03-12_imac-copy/intro",
      title: "iMac review copy", body: meetingBody,
    })] : []),
  ];
  return { directories, pages };
}

const definitions = {
  jony: person({ names: ["Jony Ive", "Jonathan Ive"] }),
  apple: organization({ names: ["Apple", "Apple Computer"] }),
  review: meeting({
    date: "1998-03-12", participants: ["jony"], organizations: ["apple"],
    concepts: ["Bondi blue", "USB"],
  }),
};

const noActivity: TurnToolActivity = {
  calls: [], anyContextUse: false, guidancePrepared: false,
  mutationAttempted: false, mutationSucceeded: false,
};

describe("story subject resolution", () => {
  test("resolves a meeting from date, participants, links, and concepts without knowing its slug", () => {
    const resolved = resolveStorySubjects(buildKnowledgeGraph(fixture()), definitions);
    expect(resolved.subjects.get("review")?.status).toBe("resolved");
    expect(resolved.subjects.get("review")?.candidate?.path)
      .toBe("meetings/1998/03/1998-03-12_blue-review");
  });

  test("keeps a stable binding when the agent changes the meeting path", () => {
    const firstGraph = buildKnowledgeGraph(fixture());
    const first = resolveStorySubjects(firstGraph, definitions);
    const movedGraph = buildKnowledgeGraph(fixture({
      meetingPath: "meetings/1998/03/1998-03-12_imac-industrial-design",
      meetingVersion: 2,
    }));
    const second = resolveStorySubjects(movedGraph, definitions, first.bindings);
    expect(second.subjects.get("review")?.candidate?.path)
      .toBe("meetings/1998/03/1998-03-12_imac-industrial-design");
    expect(candidateChanged(
      first.subjects.get("review")?.candidate,
      second.subjects.get("review")?.candidate,
    )).toBe(true);
  });

  test("reports equally plausible duplicates as ambiguous", () => {
    const resolved = resolveStorySubjects(buildKnowledgeGraph(fixture({ duplicate: true })), definitions);
    expect(resolved.subjects.get("review")?.status).toBe("ambiguous");
    expect(resolved.subjects.get("review")?.alternatives).toHaveLength(2);
  });

  test("resolves a durable subject on a company aspect page without confusing it with the company", () => {
    const snapshot = fixture();
    snapshot.pages.push(page({
      id: "apple-products",
      directoryId: "company-apple",
      path: "companies/apple-computer/products",
      title: "Products",
      body: "The iMac is an all-in-one Macintosh with a Bondi blue enclosure.",
    }));
    const resolved = resolveStorySubjects(buildKnowledgeGraph(snapshot), {
      apple: definitions.apple,
      imac: durableSubject({ names: ["iMac"], concepts: ["Bondi blue"] }),
    });
    expect(resolved.subjects.get("apple")?.candidate?.path).toBe("companies/apple-computer");
    expect(resolved.subjects.get("imac")?.status).toBe("resolved");
    expect(resolved.subjects.get("imac")?.candidate?.path).toBe("companies/apple-computer/products");
  });

  test("treats a generic entity folder as canonical instead of duplicating its detail pages", () => {
    const snapshot = fixture();
    snapshot.directories.push({
      id: "topic-imac", path: "topics/imac-computer", version: 1,
      title: "iMac", summary: "Apple's all-in-one computer.",
    });
    snapshot.pages.push(
      page({
        id: "imac-intro", directoryId: "topic-imac", path: "topics/imac-computer/intro",
        title: "iMac", body: "The iMac is Apple's all-in-one Macintosh.",
      }),
      page({
        id: "imac-design", directoryId: "topic-imac", path: "topics/imac-computer/design",
        title: "Industrial design", body: "The original enclosure was Bondi blue.",
      }),
    );
    const graph = buildKnowledgeGraph(snapshot);
    const resolved = resolveStorySubjects(graph, {
      imac: durableSubject({ names: ["iMac"], concepts: ["Bondi blue"] }),
    });
    expect(resolved.subjects.get("imac")?.status).toBe("resolved");
    expect(resolved.subjects.get("imac")?.candidate?.path).toBe("topics/imac-computer");
    expect(graph.candidates.some((candidate) => candidate.path === "topics/imac-computer/design"))
      .toBe(false);
  });

  test("recognizes stable page and directory references as graph links", () => {
    const snapshot = fixture();
    snapshot.pages.find((candidate) => candidate.id === "review-intro")!.body =
      "[Jony](context-use://page/jony-intro) and [Apple](context-use://directory/company-apple) reviewed iMac.";
    const graph = buildKnowledgeGraph(snapshot);
    const review = graph.byId.get("directory:meeting-review")!;
    expect(candidateLinksTo(review, graph.byId.get("directory:people-jony")!)).toBe(true);
    expect(candidateLinksTo(review, graph.byId.get("directory:company-apple")!)).toBe(true);
  });
});

describe("story partial scoring", () => {
  test("matches whole terms and treats thousands separators as typography", () => {
    expect(termsScore("The price is $1,299 for 1,000 songs and is for US Mac users.", {
      all: ["1299", "1000", "US"],
    })).toBe(1);
    expect(termsScore("The price is for business users.", { all: ["US"] })).toBe(0);
  });

  test("awards the dated half of a timeline check when its occurrence link is absent", () => {
    const snapshot = fixture();
    snapshot.pages.find((candidate) => candidate.path.endsWith("/timeline"))!.body =
      "## 1998\n\n### March\n\n- **12 March** — settled the Bondi blue direction.";
    const graph = buildKnowledgeGraph(snapshot);
    const resolution = resolveStorySubjects(graph, definitions);
    const evalStory = story({
      id: "fixture", title: "Fixture", description: "Fixture", subjects: definitions,
      turns: [{
        id: "turn", date: "1998-03-12", user: "Fixture",
        expect: [exists("review"), linked("review", "jony"), timelineEvent("jony", {
          date: "1998-03-12", occurrence: "review",
        })],
      }],
    });
    const score = scoreStoryTurn({
      story: evalStory,
      turn: evalStory.turns[0]!,
      before: buildKnowledgeGraph({ directories: [], pages: [] }),
      after: graph,
      resolution,
      activity: noActivity,
    });
    expect(score.assertions.find((assertion) => assertion.id.startsWith("timeline"))?.score).toBe(0.5);
    expect(score.assertions.find((assertion) => assertion.id === "home.review")?.score).toBe(1);
    expect(score.score).toBeGreaterThan(0.8);
    expect(score.score).toBeLessThan(1);
  });

  test("scores identity separately from placement in the prescribed template subtree", () => {
    const graph = buildKnowledgeGraph(fixture({
      meetingPath: "topics/1998-03-12-blue-review",
    }));
    const resolution = resolveStorySubjects(graph, definitions);
    expect(resolution.subjects.get("review")?.status).toBe("resolved");
    const evalStory = story({
      id: "fixture", title: "Fixture", description: "Fixture", subjects: definitions,
      turns: [{ id: "turn", date: "1998-03-12", user: "Fixture", expect: [exists("review")] }],
    });
    const score = scoreStoryTurn({
      story: evalStory,
      turn: evalStory.turns[0]!,
      before: buildKnowledgeGraph({ directories: [], pages: [] }),
      after: graph,
      resolution,
      activity: noActivity,
    });
    expect(score.assertions.find((assertion) => assertion.id === "exists.review")?.score).toBe(1);
    expect(score.assertions.find((assertion) => assertion.id === "home.review")?.score).toBe(0);
    expect(score.dimensions.find((dimension) => dimension.dimension === "placement")?.score).toBe(0);
    expect(score.score).toBe(0.5);
  });

  test("credits a canonical subject reused from an earlier story", () => {
    const graph = buildKnowledgeGraph(fixture());
    const resolution = resolveStorySubjects(graph, definitions);
    const evalStory = story({
      id: "fixture", title: "Fixture", description: "Fixture", subjects: definitions,
      turns: [{ id: "turn", date: "1998-03-12", user: "Fixture", expect: [created("review")] }],
    });
    const score = scoreStoryTurn({
      story: evalStory,
      turn: evalStory.turns[0]!,
      before: graph,
      after: graph,
      resolution,
      activity: noActivity,
    });
    expect(score.assertions.find((assertion) => assertion.id === "created.review"))
      .toMatchObject({ score: 1, message: "review was reused without duplication" });
  });

  test("uses the containing entity timeline for a durable aspect page", () => {
    const snapshot = fixture();
    snapshot.pages.push(
      page({
        id: "apple-products", directoryId: "company-apple",
        path: "companies/apple-computer/products", title: "Products",
        body: "The iMac is an all-in-one Macintosh with a Bondi blue enclosure.",
      }),
      page({
        id: "apple-timeline", directoryId: "company-apple",
        path: "companies/apple-computer/timeline", title: "Apple timeline",
        body: "## 1998\n\n### March\n\n- **12 March** — [[meetings/1998/03/1998-03-12_blue-review/intro|iMac design review]].",
      }),
    );
    const expandedDefinitions = {
      ...definitions,
      imac: durableSubject({ names: ["iMac"], concepts: ["Bondi blue"] }),
    };
    const graph = buildKnowledgeGraph(snapshot);
    const resolution = resolveStorySubjects(graph, expandedDefinitions);
    const evalStory = story({
      id: "fixture", title: "Fixture", description: "Fixture", subjects: expandedDefinitions,
      turns: [{
        id: "turn", date: "1998-03-12", user: "Fixture",
        expect: [timelineEvent("imac", { date: "1998-03-12", occurrence: "review" })],
      }],
    });
    const score = scoreStoryTurn({
      story: evalStory,
      turn: evalStory.turns[0]!,
      before: buildKnowledgeGraph({ directories: [], pages: [] }),
      after: graph,
      resolution,
      activity: noActivity,
    });
    expect(score.score).toBe(1);
    expect(score.assertions[0]?.evidence).toContain("companies/apple-computer/timeline");
  });
});

describe("story session traces", () => {
  test("extracts a resumable Codex thread id and mutation stages", () => {
    const output = [
      JSON.stringify({ type: "thread.started", thread_id: "thread-123" }),
      JSON.stringify({ type: "item.completed", item: { id: "1", type: "mcp_tool_call", tool: "prepare_knowledge_write", status: "completed" } }),
      JSON.stringify({ type: "item.completed", item: { id: "2", type: "mcp_tool_call", tool: "create_page", status: "completed" } }),
    ].join("\n");
    expect(storySessionInternals.threadIdFrom(output)).toBe("thread-123");
    expect(storySessionInternals.codexActivity(output)).toMatchObject({
      anyContextUse: true,
      guidancePrepared: true,
      mutationAttempted: true,
      mutationSucceeded: true,
    });
  });
});
