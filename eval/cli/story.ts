import { steveJobsV1 } from "../data/steve-jobs-v1/suite.ts";
import { runStorySuite } from "../runner/story/runner.ts";
import type { EvalProvider } from "../runner/agent.ts";

export function listStories(): void {
  for (const story of steveJobsV1.stories) {
    console.log(`${story.id.padEnd(30)} ${story.title}`);
  }
}

export async function runStories(options: {
  provider: EvalProvider;
  story?: string;
  all?: boolean;
  repeat?: number;
}): Promise<void> {
  await runStorySuite(steveJobsV1, options);
}

export async function runJourney(options: {
  provider: EvalProvider;
  repeat?: number;
}): Promise<void> {
  await runStorySuite(steveJobsV1, { ...options, journey: true });
}
