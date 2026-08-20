import { ALL_STORIES, configOrigin, describeSelection, type EvalConfig } from "../config.ts";
import { harnessLabel } from "../runner/agent.ts";
import { runDistillation } from "../runner/distill.ts";
import { style } from "../runner/terminal.ts";
import { runLocomoCommand } from "./locomo.ts";
import { runLongMemEvalCommand } from "./longmemeval.ts";
import { askQuestionsCommand, scoreAnswersCommand, seedCommand } from "./qa.ts";
import { runJourney, runStories } from "./story.ts";

/**
 * Runs the evaluation the configuration names, on the harness it names.
 *
 * The individual commands still exist and still take flags; this one exists so that what
 * gets run is a property of the repository rather than of the command line someone typed,
 * which is what makes two runs comparable and a setup check meaningful.
 */
export async function runConfiguredEval(config: EvalConfig): Promise<void> {
  const { harness, knowledgeTemplate } = config;
  const selection = config.eval;
  console.log(style.heading(`\nRunning ${describeSelection(selection)}`));
  console.log(`${style.dim("Harness:")} ${harnessLabel(harness)}`);
  console.log(`${style.dim("Knowledge template:")} ${knowledgeTemplate}`);
  console.log(style.dim(`Configured by ${configOrigin(config)}\n`));

  if (selection.command === "distill") {
    await runDistillation({
      harness,
      knowledgeTemplate,
      corpus: selection.corpus,
      window: selection.window,
      batches: selection.batches,
    });
    return;
  }

  if (selection.command === "qa") {
    // The two corpora differ only in how the knowledge base under test comes to exist:
    // world-v1 is seeded as it stands, amara-life-v1 has to be distilled first. Asking is
    // the same question set through the same sessions either way.
    if (selection.corpus === "world-v1") {
      await seedCommand({ batches: selection.batches, knowledgeTemplate });
    } else {
      await runDistillation({
        harness,
        knowledgeTemplate,
        corpus: selection.corpus,
        window: selection.window,
        batches: selection.batches,
      });
    }
    // Both preparations leave the run they wrote as the latest one, and asking has to
    // happen against the knowledge base still loaded in the stack.
    await askQuestionsCommand({ harness });
    scoreAnswersCommand();
    return;
  }

  if (selection.command === "longmem") {
    await runLongMemEvalCommand({
      harness,
      knowledgeTemplate,
      ...(selection.case ? { caseId: selection.case } : {}),
      ...(selection.limit ? { limit: selection.limit } : {}),
      ...(selection.stratify ? { stratify: selection.stratify } : {}),
      ...(selection.all ? { all: selection.all } : {}),
      ...(selection.sessionsPerBatch ? { sessionsPerBatch: selection.sessionsPerBatch } : {}),
    });
    return;
  }

  if (selection.command === "locomo") {
    await runLocomoCommand({
      harness,
      knowledgeTemplate,
      ...(selection.conversation ? { conversationId: selection.conversation } : {}),
      ...(selection.limit ? { limit: selection.limit } : {}),
      ...(selection.all ? { all: selection.all } : {}),
      ...(selection.questions ? { questions: selection.questions } : {}),
      ...(selection.stratify ? { stratify: selection.stratify } : {}),
      ...(selection.sessionsPerBatch ? { sessionsPerBatch: selection.sessionsPerBatch } : {}),
    });
    return;
  }

  if (selection.command === "story") {
    await runStories(selection.story === ALL_STORIES
      ? { harness, knowledgeTemplate, all: true, ...(selection.repeat ? { repeat: selection.repeat } : {}) }
      : { harness, knowledgeTemplate, story: selection.story, ...(selection.repeat ? { repeat: selection.repeat } : {}) });
    return;
  }

  await runJourney({ harness, knowledgeTemplate, ...(selection.repeat ? { repeat: selection.repeat } : {}) });
}
