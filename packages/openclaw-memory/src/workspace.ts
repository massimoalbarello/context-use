import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { z } from 'zod';
import { ConnectionError } from './error';

const FILES = [
  'AGENTS.md',
  'SOUL.md',
  'USER.md',
  'TOOLS.md',
  'HEARTBEAT.md',
  'MEMORY.md',
  'memory.md',
] as const;
const PRIVATE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const PERMISSION_MASK = 0o777;
const PROVIDER = /context[-_ ]use/i;
const SECTION = /^(?:Memory:\s*)?Context[- ]use(?: Only)?$/i;
const sentences = new Intl.Segmenter('en', { granularity: 'sentence' });
const PROVIDER_INSTRUCTIONS = [
  /Context[- ]use is[^.!?\n]*(?:sole|exclusive) durable personal[- ]memory/i,
  /\b(?:use|prefer) (?:the native `?context_use_|Context[- ]use (?:normally|whenever))/i,
  /\breconcile (?:it|durable|new knowledge).*\b(?:into|through)/i,
  /\buse the Context[- ]use MCP|\b(?:if|when) Context[- ]use is unavailable/i,
  /\bnative OpenClaw memory plugin[^.\n]*connects|\bcheck `?openclaw context-use status/i,
  /\bContext[- ]use (?:mutation|is fail-closed)|successful Context[- ]use save|\bread `?context_use_/i,
];

// Recognize operational instructions from the earlier integration, not arbitrary
// mentions of the product in personal notes, examples or conversation history.
function isProviderInstruction(text: string): boolean {
  return PROVIDER.test(text) && PROVIDER_INSTRUCTIONS.some((pattern) => pattern.test(text));
}

function retireParagraph(input: { text: string; integrationSection: boolean }): string {
  const inline = input.text.replace(/recall and curate knowledge through Context Use;\s*/g, '');
  if (!input.integrationSection && !isProviderInstruction(inline)) {
    return inline;
  }
  return [...sentences.segment(inline)]
    .map(({ segment }) => {
      // Preserve the operator's channel policy while removing its provider dependency.
      if (/^Use Context Use normally/i.test(segment)) {
        return segment.replace(
          /^Use Context Use normally/i,
          'Use the currently available memory tools normally',
        );
      }
      if (
        isProviderInstruction(segment) ||
        (/^(?:Never |Do not maintain |OpenClaw.s local )/i.test(segment) &&
          /MEMORY\.md|memory\/|local memory|local note|workspace file/i.test(segment))
      ) {
        return '';
      }
      return segment;
    })
    .join('')
    .trimEnd();
}

export function retireWorkspaceInstructions(source: string): string {
  const tree = fromMarkdown(source);
  const edits: { start: number; end: number; text: string }[] = [];
  const sections: { start: number; end: number }[] = [];
  for (let index = 0; index < tree.children.length; index += 1) {
    const node = tree.children[index]!;
    if (node.type !== 'heading') {
      continue;
    }
    const heading = source
      .slice(node.position!.start.offset, node.position!.end.offset)
      .replace(/^#+\s*/, '')
      .trim();
    if (!SECTION.test(heading)) {
      continue;
    }
    const following = tree.children
      .slice(index + 1)
      .find((next) => next.type === 'heading' && next.depth <= node.depth);
    const start = node.position!.start.offset!;
    const end = following?.position?.start.offset ?? source.length;
    if (isProviderInstruction(source.slice(start, end))) {
      sections.push({ start, end });
      edits.push({
        start,
        end: node.position!.end.offset!,
        text: `${'#'.repeat(node.depth)} Memory`,
      });
    }
  }
  type Block = (typeof tree)['children'][number];
  type Node = Block | Extract<Block, { type: 'list' }>['children'][number];
  function paragraphEdit(input: {
    node: Extract<Block, { type: 'paragraph' }>;
    container?: Node;
  }): void {
    const { node, container } = input;
    const start = node.position!.start.offset!;
    const end = node.position!.end.offset!;
    const before = source.slice(start, end);
    const text = retireParagraph({
      text: before,
      integrationSection: sections.some((section) => start >= section.start && end <= section.end),
    });
    if (text !== before) {
      edits.push({
        start: text ? start : (container?.position?.start.offset ?? start),
        end: text ? end : (container?.position?.end.offset ?? end),
        text,
      });
    }
  }
  function visit(input: { node: Node; container?: Node }): void {
    const { node } = input;
    if (node.type === 'paragraph') {
      paragraphEdit({ node, container: input.container });
    } else if (node.type === 'list' || node.type === 'listItem') {
      const container = node.type === 'listItem' && node.children.length === 1 ? node : undefined;
      node.children.forEach((child) => {
        visit({ node: child, container });
      });
    }
  }
  tree.children.forEach((node) => {
    visit({ node });
  });
  let result = source;
  // biome-ignore lint/complexity/useMaxParams: Array.sort defines a two-argument comparator.
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}

const BackupSchema = z.object({
  workspace: z.string().refine(isAbsolute),
  files: z.array(
    z.object({
      name: z.enum(FILES),
      before: z.string(),
      after: z.string(),
      mode: z.number().int().min(0).max(PERMISSION_MASK),
    }),
  ),
});

async function workspaceFile(
  path: string,
): Promise<{ text: string; mode: number; identity: string; mutable: boolean } | undefined> {
  try {
    const stats = await lstat(path);
    if (!stats.isFile() && !stats.isSymbolicLink()) {
      return undefined;
    }
    return {
      text: await readFile(path, 'utf8'),
      mode: stats.mode & PERMISSION_MASK,
      identity: `${stats.dev}:${stats.ino}`,
      mutable: stats.isFile() && stats.nlink === 1,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function replaceFile(input: {
  path: string;
  before: string;
  after: string;
  mode: number;
}): Promise<void> {
  const temporary = `${input.path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, input.after, { mode: input.mode, flag: 'wx' });
    const current = await workspaceFile(input.path);
    if (!current?.mutable || current.text !== input.before) {
      throw new ConnectionError(
        `Workspace changed during cleanup: ${input.path}. Retry the command.`,
      );
    }
    await rename(temporary, input.path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function retireWorkspace(input: {
  workspace: string;
  backups: string;
}): Promise<string | undefined> {
  const files: z.infer<typeof BackupSchema>['files'] = [];
  const visited = new Set<string>();
  for (const name of FILES) {
    const file = await workspaceFile(join(input.workspace, name));
    if (!file || visited.has(file.identity)) {
      continue;
    }
    visited.add(file.identity);
    const after = retireWorkspaceInstructions(file.text);
    if (after !== file.text) {
      if (!file.mutable) {
        throw new ConnectionError(
          `Workspace cleanup requires a regular, unlinked file: ${join(input.workspace, name)}.`,
        );
      }
      files.push({ name, before: file.text, after, mode: file.mode });
    }
  }
  if (!files.length) {
    return undefined;
  }
  const directory = join(input.backups, randomUUID());
  await mkdir(directory, { recursive: true, mode: DIRECTORY_MODE });
  // Durable backup before the first mutation: partial cleanup is retryable and
  // recovery compares each file independently, preserving subsequent edits.
  await writeFile(
    join(directory, 'workspace.json'),
    JSON.stringify({ workspace: resolve(input.workspace), files }),
    { mode: PRIVATE_MODE, flag: 'wx' },
  );
  try {
    for (const file of files) {
      await replaceFile({ ...file, path: join(input.workspace, file.name) });
    }
  } catch {
    throw new ConnectionError(
      `Workspace cleanup was interrupted. Retry the command; recovery backup: ${directory}`,
    );
  }
  return directory;
}

export async function restoreWorkspace(directory: string): Promise<string[]> {
  const backup = BackupSchema.parse(
    JSON.parse(await readFile(join(directory, 'workspace.json'), 'utf8')),
  );
  const preserved: string[] = [];
  for (const file of backup.files) {
    const path = join(backup.workspace, file.name);
    const current = await workspaceFile(path);
    if (current?.mutable && current.text === file.after) {
      await replaceFile({ path, before: file.after, after: file.before, mode: current.mode });
    } else if (current?.text !== file.before) {
      preserved.push(path);
    }
  }
  return preserved;
}
