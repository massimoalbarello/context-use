import { posix } from "node:path";
import type {
  KnowledgeExportAsset,
  KnowledgeExportDirectory,
  KnowledgeExportPage,
  KnowledgeExportSnapshot,
} from "@context-use/database";
import { normalizeInternalPageLinks } from "@context-use/database";
import { TextReader, ZipWriter } from "@zip.js/zip.js";
import type { ObjectStorage } from "./storage.ts";

const EXPORT_ROOT = "context-use-export";
export const MAX_KNOWLEDGE_EXPORT_BYTES = 5 * 1024 ** 3;
const ZIP_DATE = new Date("1980-01-01T00:00:00.000Z");
const MAX_COMPONENT_BYTES = 180;
const UUID = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";
const PAGE_REFERENCE = new RegExp(`(!?)\\[([^\\]]*)\\]\\(context-use:\\/\\/page\\/${UUID}\\)`, "gi");
const DIRECTORY_REFERENCE = new RegExp(`\\[([^\\]]*)\\]\\(context-use:\\/\\/directory\\/${UUID}\\)`, "gi");
const ASSET_REFERENCE = new RegExp(`!\\[([^\\]]*)\\]\\(context-use:\\/\\/asset\\/${UUID}\\)`, "gi");
const WIKI_REFERENCE = /(?<!!)\[\[([a-z0-9][a-z0-9/_-]*)(?:\|([^\]\n]+))?\]\]/gi;

export type PlannedKnowledgeExportPage = KnowledgeExportPage & {
  vaultPath: string;
  body: string;
};

export type PlannedKnowledgeExportDirectory = KnowledgeExportDirectory & {
  vaultPath: string;
  body: string;
};

export type PlannedKnowledgeExportAsset = KnowledgeExportAsset & { vaultPath: string };

export type PlannedKnowledgeExport = {
  directories: PlannedKnowledgeExportDirectory[];
  pages: PlannedKnowledgeExportPage[];
  assets: PlannedKnowledgeExportAsset[];
};

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (utf8Length(value) <= maxBytes) return value;
  let result = "";
  for (const character of value) {
    if (utf8Length(result + character) > maxBytes) break;
    result += character;
  }
  return result;
}

function safeComponent(value: string, fallback: string, useBasename = false): string {
  const normalized = value.normalize("NFC");
  const source = useBasename ? normalized.split(/[\\/]/).at(-1) ?? "" : normalized;
  let safe = source
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  if (!safe || safe === "." || safe === "..") safe = fallback;
  const stem = safe.split(".")[0] ?? safe;
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) safe = `_${safe}`;
  return truncateUtf8(safe, MAX_COMPONENT_BYTES) || fallback;
}

function collisionKey(path: string): string {
  return path.normalize("NFKC").toLocaleLowerCase("en-US");
}

function knowledgeDirectories(paths: string[]): Map<string, string> {
  const directories = new Set<string>([""]);
  for (const currentPath of paths.filter(Boolean)) {
    const segments = currentPath.split("/");
    for (let index = 1; index <= segments.length; index += 1) {
      directories.add(segments.slice(0, index).join("/"));
    }
  }
  const mapped = new Map<string, string>([["", ""]]);
  const usedByParent = new Map<string, Set<string>>();
  for (const directory of [...directories].filter(Boolean).sort((left, right) => {
    const depth = left.split("/").length - right.split("/").length;
    return depth || left.localeCompare(right);
  })) {
    const parent = posix.dirname(directory) === "." ? "" : posix.dirname(directory);
    const mappedParent = mapped.get(parent)!;
    const originalName = posix.basename(directory);
    const preferred = safeComponent(originalName, "folder");
    const used = usedByParent.get(mappedParent) ?? new Set<string>();
    usedByParent.set(mappedParent, used);
    let name = preferred;
    let counter = 2;
    while (used.has(collisionKey(name))) {
      name = `${truncateUtf8(preferred, MAX_COMPONENT_BYTES - 8)}-${counter}`;
      counter += 1;
    }
    used.add(collisionKey(name));
    mapped.set(directory, mappedParent ? `${mappedParent}/${name}` : name);
  }
  return mapped;
}

function extensionParts(filename: string): { stem: string; extension: string } {
  const extension = posix.extname(filename);
  return extension && extension !== filename
    ? { stem: filename.slice(0, -extension.length), extension }
    : { stem: filename, extension: "" };
}

function allocateFile(
  parent: string,
  preferredName: string,
  pathLeaf: string,
  used: Set<string>,
): string {
  const preferredPath = parent ? `${parent}/${preferredName}` : preferredName;
  if (!used.has(collisionKey(preferredPath))) {
    used.add(collisionKey(preferredPath));
    return preferredPath;
  }
  const { stem, extension } = extensionParts(preferredName);
  const suffix = safeComponent(pathLeaf, "item");
  let counter = 1;
  while (true) {
    const qualifier = counter === 1 ? suffix : `${suffix}-${counter}`;
    const maxStemBytes = Math.max(24, MAX_COMPONENT_BYTES - utf8Length(extension) - utf8Length(qualifier) - 3);
    const name = `${truncateUtf8(stem, maxStemBytes)} (${qualifier})${extension}`;
    const candidate = parent ? `${parent}/${name}` : name;
    if (!used.has(collisionKey(candidate))) {
      used.add(collisionKey(candidate));
      return candidate;
    }
    counter += 1;
  }
}

function markdownTarget(from: string, to: string): string {
  const relative = posix.relative(posix.dirname(from), to) || posix.basename(to);
  return relative.split("/").map((segment) => {
    if (segment === "." || segment === "..") return segment;
    return encodeURIComponent(segment).replace(/[!'()*]/g, (character) => (
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    ));
  }).join("/");
}

function rewriteReferences(
  markdown: string,
  sourceDirectory: string,
  sourceVaultPath: string,
  pagePaths: Map<string, string>,
  pagePathsByKnowledgePath: Map<string, string>,
  directoryPaths: Map<string, string>,
  directoryPathsByKnowledgePath: Map<string, string>,
  assetPaths: Map<string, string>,
): string {
  let body = normalizeInternalPageLinks(markdown).replace(
    PAGE_REFERENCE,
    (_match, prefix: string, label: string, id: string) => {
      const target = pagePaths.get(id.toLowerCase());
      return target
        ? `${prefix}[${label}](${markdownTarget(sourceVaultPath, target)})`
        : label || "Missing page";
    },
  );
  body = body.replace(
    DIRECTORY_REFERENCE,
    (_match, label: string, id: string) => {
      const target = directoryPaths.get(id.toLowerCase());
      return target
        ? `[${label}](${markdownTarget(sourceVaultPath, target)})`
        : label || "Missing directory";
    },
  );
  body = body.replace(
    ASSET_REFERENCE,
    (_match, label: string, id: string) => {
      const target = assetPaths.get(id.toLowerCase());
      return target
        ? `![${label}](${markdownTarget(sourceVaultPath, target)})`
        : label || "Missing asset";
    },
  );
  body = body.replace(
    WIKI_REFERENCE,
    (_match, rawPath: string, rawLabel: string | undefined) => {
      const path = rawPath.toLowerCase();
      const candidates = path.includes("/") ? [path] : [sourceDirectory ? `${sourceDirectory}/${path}` : path, path];
      const target = candidates.map((candidate) => (
        pagePathsByKnowledgePath.get(candidate) ?? directoryPathsByKnowledgePath.get(candidate)
      )).find(Boolean);
      const label = rawLabel?.trim() || path.split("/").at(-1) || path;
      return target ? `[${label}](${markdownTarget(sourceVaultPath, target)})` : label;
    },
  );
  return body;
}

function metadataFrontmatter(kind: "page" | "directory", path: string, title: string, summary: string): string {
  return [
    "---",
    `type: ${JSON.stringify(kind)}`,
    `path: ${JSON.stringify(path)}`,
    `title: ${JSON.stringify(title)}`,
    `summary: ${JSON.stringify(summary)}`,
    "---",
  ].join("\n");
}

function markdownLabel(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function parentKnowledgePath(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

export function planKnowledgeExport(snapshot: KnowledgeExportSnapshot): PlannedKnowledgeExport {
  const items = [
    ...snapshot.pages.map((page) => ({ kind: "page" as const, id: page.id, path: page.current_path, page })),
    ...snapshot.assets.map((asset) => ({ kind: "asset" as const, id: asset.id, path: asset.current_path, asset })),
  ].sort((left, right) => left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
  const directories = knowledgeDirectories([
    ...snapshot.directories.map(({ current_path }) => current_path),
    ...items.map(({ path }) => parentKnowledgePath(path)),
  ]);
  const used = new Set<string>([...directories.values()].filter(Boolean).map(collisionKey));
  const pagePaths = new Map<string, string>();
  const pagePathsByKnowledgePath = new Map<string, string>();
  const directoryPaths = new Map<string, string>();
  const directoryPathsByKnowledgePath = new Map<string, string>();
  const assetPaths = new Map<string, string>();

  for (const directory of snapshot.directories) {
    const mapped = directories.get(directory.current_path) ?? "";
    const vaultPath = mapped ? `${mapped}/index.md` : "index.md";
    if (used.has(collisionKey(vaultPath))) throw new Error(`Directory index path collision at ${vaultPath}`);
    used.add(collisionKey(vaultPath));
    directoryPaths.set(directory.id.toLowerCase(), vaultPath);
    directoryPathsByKnowledgePath.set(directory.current_path, vaultPath);
  }

  for (const item of items) {
    const sourceParent = item.path.split("/").slice(0, -1).join("/");
    const parent = directories.get(sourceParent) ?? "";
    const pathLeaf = item.path.split("/").at(-1) ?? "item";
    if (item.kind === "page") {
      const safeTitle = safeComponent(item.page.title, pathLeaf);
      const filename = safeTitle.toLowerCase().endsWith(".md") ? safeTitle : `${safeTitle}.md`;
      const path = allocateFile(parent, filename, pathLeaf, used);
      pagePaths.set(item.id.toLowerCase(), path);
      pagePathsByKnowledgePath.set(item.path, path);
    } else {
      const filename = safeComponent(item.asset.filename, pathLeaf, true);
      assetPaths.set(item.id.toLowerCase(), allocateFile(parent, filename, pathLeaf, used));
    }
  }

  return {
    directories: snapshot.directories.map((directory) => {
      const vaultPath = directoryPaths.get(directory.id.toLowerCase())!;
      const intro = rewriteReferences(
        directory.intro_markdown,
        directory.current_path,
        vaultPath,
        pagePaths,
        pagePathsByKnowledgePath,
        directoryPaths,
        directoryPathsByKnowledgePath,
        assetPaths,
      );
      const childDirectories = snapshot.directories
        .filter((candidate) => candidate.current_path && parentKnowledgePath(candidate.current_path) === directory.current_path)
        .map((candidate) => ({
          kind: "directory" as const,
          id: candidate.id,
          path: candidate.current_path,
          title: candidate.title,
          summary: candidate.summary,
          vaultPath: directoryPaths.get(candidate.id.toLowerCase())!,
        }));
      const childPages = snapshot.pages
        .filter((candidate) => parentKnowledgePath(candidate.current_path) === directory.current_path)
        .map((candidate) => ({
          kind: "page" as const,
          id: candidate.id,
          path: candidate.current_path,
          title: candidate.title,
          summary: candidate.summary,
          vaultPath: pagePaths.get(candidate.id.toLowerCase())!,
        }));
      const children = [...childDirectories, ...childPages]
        .sort((left, right) => left.kind.localeCompare(right.kind) || left.path.localeCompare(right.path));
      const listing = children.length
        ? children.map((child) => (
          `- [${markdownLabel(child.title)}](${markdownTarget(vaultPath, child.vaultPath)}) — ${child.summary}`
        )).join("\n")
        : "_This directory has no child pages or directories._";
      return {
        ...directory,
        vaultPath,
        body: [
          metadataFrontmatter("directory", directory.current_path, directory.title, directory.summary),
          intro.trim(),
          "## Contents",
          listing,
        ].filter(Boolean).join("\n\n"),
      };
    }),
    pages: snapshot.pages.map((page) => {
      const vaultPath = pagePaths.get(page.id.toLowerCase())!;
      const rewritten = rewriteReferences(
        page.body_markdown,
        parentKnowledgePath(page.current_path),
        vaultPath,
        pagePaths,
        pagePathsByKnowledgePath,
        directoryPaths,
        directoryPathsByKnowledgePath,
        assetPaths,
      );
      return {
        ...page,
        vaultPath,
        body: [
          metadataFrontmatter("page", page.current_path, page.title, page.summary),
          rewritten,
        ].filter(Boolean).join("\n\n"),
      };
    }),
    assets: snapshot.assets.map((asset) => ({
      ...asset,
      vaultPath: assetPaths.get(asset.id.toLowerCase())!,
    })),
  };
}

async function writeKnowledgeExport(
  writable: WritableStream<Uint8Array>,
  planned: PlannedKnowledgeExport,
  storage: ObjectStorage,
  signal: AbortSignal,
): Promise<void> {
  const zip = new ZipWriter(writable, {
    useWebWorkers: false,
    keepOrder: true,
  });
  await zip.add(`${EXPORT_ROOT}/`, undefined, {
    directory: true,
    lastModDate: ZIP_DATE,
    signal,
  });
  for (const directory of planned.directories) {
    await zip.add(`${EXPORT_ROOT}/${directory.vaultPath}`, new TextReader(directory.body), {
      compressionMethod: 8,
      level: 6,
      lastModDate: ZIP_DATE,
      signal,
    });
  }
  for (const page of planned.pages) {
    await zip.add(`${EXPORT_ROOT}/${page.vaultPath}`, new TextReader(page.body), {
      compressionMethod: 8,
      level: 6,
      lastModDate: ZIP_DATE,
      signal,
    });
  }
  for (const asset of planned.assets) {
    const content = new Response(await storage.read(asset.s3_object_key)).body;
    if (!content) throw new Error(`Asset content is missing for ${asset.current_path}`);
    // zip.js promotes unknown-length streams to Zip64, which macOS Archive Utility
    // rejects in some cases. The captured size keeps ordinary exports as classic ZIP.
    await zip.add(`${EXPORT_ROOT}/${asset.vaultPath}`, {
      readable: content,
      size: Number(asset.size_bytes),
    }, {
      compressionMethod: 0,
      lastModDate: ZIP_DATE,
      signal,
    });
  }
  await zip.close();
}

export function streamKnowledgeExport(
  snapshot: KnowledgeExportSnapshot,
  storage: ObjectStorage,
): ReadableStream<Uint8Array> {
  const planned = planKnowledgeExport(snapshot);
  const bridge = new TransformStream<Uint8Array, Uint8Array>();
  const reader = bridge.readable.getReader();
  const abort = new AbortController();
  let finished = false;
  const producer = writeKnowledgeExport(bridge.writable, planned, storage, abort.signal);

  return new ReadableStream<Uint8Array>({
    start(nextController) {
      void producer.catch(async (error) => {
        if (finished) return;
        finished = true;
        nextController.error(error);
        await reader.cancel(error).catch(() => undefined);
      });
    },
    async pull(nextController) {
      if (finished) return;
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          finished = true;
          nextController.close();
          return;
        }
        nextController.enqueue(chunk.value);
      } catch (error) {
        if (!finished) {
          finished = true;
          nextController.error(error);
        }
      }
    },
    async cancel(reason) {
      if (finished) return;
      finished = true;
      abort.abort(reason);
      await reader.cancel(reason).catch(() => undefined);
      await producer.catch(() => undefined);
    },
  });
}
