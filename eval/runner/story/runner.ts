import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { runStackCommand } from "../../../scripts/local-stack.ts";
import type { EvalProvider } from "../agent.ts";
import { EVAL_STORY_RESULTS_ROOT } from "../results.ts";
import { snapshotKnowledgeState, type KnowledgeSnapshot } from "../snapshot.ts";
import { buildKnowledgeGraph } from "./graph.ts";
import { resolveStorySubjects, type StoryResolution } from "./resolver.ts";
import { aggregateStoryScore, scoreStoryTurn, type StoryScore } from "./scoring.ts";
import { openStoryConversation } from "./session.ts";
import type { EvalStory, EvalStorySuite, StoryTurn } from "./types.ts";

const RESULTS_ROOT = EVAL_STORY_RESULTS_ROOT;

export type StoryRunOptions = {
  provider: EvalProvider;
  story?: string;
  all?: boolean;
  journey?: boolean;
  repeat?: number;
};

type StoryRun = {
  storyId: string;
  repetition: number;
  score: StoryScore;
};

export type StoryRunReport = {
  runId: string;
  suiteId: string;
  provider: EvalProvider;
  mode: "suite" | "journey";
  startedAt: string;
  completedAt: string;
  stories: StoryRun[];
};

function dateLabel(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).format(parsed);
}

export function renderStoryTurn(
  suite: EvalStorySuite,
  story: EvalStory,
  turn: StoryTurn,
  first: boolean,
  includeSuitePrelude = true,
): string {
  const prelude = story.conversationPrelude === undefined
    ? (includeSuitePrelude ? suite.conversationPrelude : null)
    : story.conversationPrelude;
  return [
    first && prelude ? prelude : "",
    `[Current date: ${dateLabel(turn.date)} (${turn.date})]`,
    turn.user,
  ].filter(Boolean).join("\n\n");
}

function resolutionJson(resolution: StoryResolution) {
  return Object.fromEntries([...resolution.subjects.entries()].map(([subject, found]) => [subject, {
    status: found.status,
    confidence: found.confidence,
    candidate: found.candidate ? {
      id: found.candidate.id,
      path: found.candidate.path,
      nodeType: found.candidate.nodeType,
      placement: found.candidate.placement,
    } : undefined,
    alternatives: found.alternatives.map((alternative) => ({
      id: alternative.candidate.id,
      path: alternative.candidate.path,
      confidence: alternative.confidence,
      evidence: alternative.evidence,
    })),
  }]));
}

async function writeSnapshot(path: string, snapshot: KnowledgeSnapshot): Promise<void> {
  await Bun.write(path, `${JSON.stringify(snapshot, null, 2)}\n`);
}

async function runOneStory(input: {
  suite: EvalStorySuite;
  story: EvalStory;
  provider: EvalProvider;
  directory: string;
  initial: KnowledgeSnapshot;
  includeSuitePrelude: boolean;
}): Promise<{ score: StoryScore; final: KnowledgeSnapshot }> {
  await mkdir(input.directory, { recursive: true });
  await writeSnapshot(join(input.directory, "initial-snapshot.json"), input.initial);
  // A conversation belongs to exactly one story. The knowledge snapshot crosses this
  // boundary; provider thread/session state does not.
  const conversation = openStoryConversation(input.provider, input.directory);
  const scores = [];
  let previous = input.initial;
  let bindings = new Map<string, string>();
  try {
    for (const [index, turn] of input.story.turns.entries()) {
      console.log(`\n  ${index + 1}/${input.story.turns.length} ${turn.id} · ${turn.date}`);
      const activity = await conversation.send({
        id: `${String(index + 1).padStart(2, "0")}-${turn.id}`,
        prompt: renderStoryTurn(
          input.suite,
          input.story,
          turn,
          index === 0,
          input.includeSuitePrelude,
        ),
      });
      const current = snapshotKnowledgeState();
      const beforeGraph = buildKnowledgeGraph(previous);
      const afterGraph = buildKnowledgeGraph(current);
      const resolution = resolveStorySubjects(afterGraph, input.story.subjects, bindings);
      bindings = resolution.bindings;
      const score = scoreStoryTurn({
        story: input.story,
        turn,
        before: beforeGraph,
        after: afterGraph,
        resolution,
        activity,
      });
      scores.push(score);
      const stem = `${String(index + 1).padStart(2, "0")}-${turn.id}`;
      await writeSnapshot(join(input.directory, `${stem}-snapshot.json`), current);
      await Bun.write(join(input.directory, `${stem}-resolution.json`),
        `${JSON.stringify(resolutionJson(resolution), null, 2)}\n`);
      await Bun.write(join(input.directory, `${stem}-activity.json`),
        `${JSON.stringify(activity, null, 2)}\n`);
      await Bun.write(join(input.directory, `${stem}-score.json`),
        `${JSON.stringify(score, null, 2)}\n`);
      console.log(`  score ${(score.score * 100).toFixed(1)}%`);
      previous = current;
    }
  } finally {
    await conversation.close();
  }
  return { score: aggregateStoryScore(input.story.id, scores), final: previous };
}

function markdownReport(report: StoryRunReport): string {
  const allStories = report.stories;
  const overall = allStories.length
    ? allStories.reduce((total, story) => total + story.score.score, 0) / allStories.length
    : 0;
  const lines = [
    `# ${report.suiteId} — ${report.mode}`,
    "",
    `- Provider: ${report.provider}`,
    `- Overall: ${(overall * 100).toFixed(1)}%`,
    `- Started: ${report.startedAt}`,
    `- Completed: ${report.completedAt}`,
    "",
  ];
  for (const run of allStories) {
    lines.push(`## ${run.storyId}${run.repetition > 1 ? ` · repetition ${run.repetition}` : ""}`, "");
    lines.push(`Score: ${(run.score.score * 100).toFixed(1)}%`, "");
    if (run.score.dimensions.length) {
      lines.push("| Dimension | Score |", "| --- | ---: |");
      for (const dimension of run.score.dimensions) {
        lines.push(`| ${dimension.dimension} | ${(dimension.score * 100).toFixed(1)}% |`);
      }
      lines.push("");
    }
    for (const turn of run.score.turns) {
      lines.push(`### ${turn.turnId} — ${(turn.score * 100).toFixed(1)}%`, "");
      for (const assertion of turn.assertions) {
        lines.push(`- ${Math.round(assertion.score * 100)}% — ${assertion.message}${
          assertion.evidence ? ` (${assertion.evidence})` : ""}`);
      }
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
}

function selectedStories(suite: EvalStorySuite, options: StoryRunOptions): EvalStory[] {
  if (options.journey) {
    return suite.journey.map((id) => {
      const found = suite.stories.find((story) => story.id === id);
      if (!found) throw new Error(`Journey references unknown story ${id}.`);
      return found;
    });
  }
  if (options.story) {
    const found = suite.stories.find((story) => story.id === options.story);
    if (!found) throw new Error(`Unknown story ${options.story}.`);
    return [found];
  }
  if (options.all) return suite.stories;
  throw new Error("Choose --story <id> or --all, or run the journey command.");
}

function planStoryConversations(stories: EvalStory[]): Array<{
  story: EvalStory;
  includeSuitePrelude: boolean;
}> {
  let suitePreludePending = true;
  return stories.map((story) => {
    const includeSuitePrelude = suitePreludePending && story.conversationPrelude === undefined;
    if (includeSuitePrelude) suitePreludePending = false;
    return { story, includeSuitePrelude };
  });
}

export async function runStorySuite(suite: EvalStorySuite, options: StoryRunOptions): Promise<string> {
  const startedAt = new Date().toISOString();
  const mode = options.journey ? "journey" : "suite";
  const runId = `${suite.id}-${mode}-${startedAt.replaceAll(":", "-").replace(".", "-")}-${options.provider}`;
  const runDirectory = join(RESULTS_ROOT, runId);
  await mkdir(runDirectory, { recursive: true });
  const stories = selectedStories(suite, options);
  const conversations = planStoryConversations(stories);
  const repeat = options.repeat ?? 1;
  const runs: StoryRun[] = [];

  for (let repetition = 1; repetition <= repeat; repetition += 1) {
    console.log(`Resetting knowledge for ${mode} repetition ${repetition}…`);
    runStackCommand("reset");
    let suiteState = snapshotKnowledgeState();
    for (const planned of conversations) {
      const { story } = planned;
      console.log(`\n=== ${story.title} ===`);
      const directory = join(runDirectory, `${String(repetition).padStart(2, "0")}-${story.id}`);
      const result = await runOneStory({
        suite,
        story,
        provider: options.provider,
        directory,
        initial: suiteState,
        includeSuitePrelude: planned.includeSuitePrelude,
      });
      runs.push({ storyId: story.id, repetition, score: result.score });
      suiteState = result.final;
    }
  }

  const report: StoryRunReport = {
    runId,
    suiteId: suite.id,
    provider: options.provider,
    mode,
    startedAt,
    completedAt: new Date().toISOString(),
    stories: runs,
  };
  await Bun.write(join(runDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const reportPath = join(runDirectory, "report.md");
  await Bun.write(reportPath, markdownReport(report));
  await Bun.write(join(RESULTS_ROOT, "latest"), `${runId}\n`);
  console.log(`\nReport: ${reportPath}`);
  return reportPath;
}

export const storyRunnerInternals = { planStoryConversations };
