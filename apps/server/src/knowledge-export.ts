import { posix } from "node:path";
import type {
  KnowledgeExportAsset,
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
const ASSET_REFERENCE = new RegExp(`!\\[([^\\]]*)\\]\\(context-use:\\/\\/asset\\/${UUID}\\)`, "gi");
const WIKI_REFERENCE = /(?<!!)\[\[([a-z0-9][a-z0-9/_-]*)(?:\|([^\]\n]+))?\]\]/gi;

export type PlannedKnowledgeExportPage = KnowledgeExportPage & {
  vaultPath: string;
  body: string;
};

export type PlannedKnowledgeExportAsset = KnowledgeExportAsset & { vaultPath: string };

export type PlannedKnowledgeExport = {
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
  const directories = new Set<string>();
  for (const currentPath of paths) {
    const segments = currentPath.split("/").slice(0, -1);
    for (let index = 1; index <= segments.length; index += 1) {
      directories.add(segments.slice(0, index).join("/"));
    }
  }
  const mapped = new Map<string, string>([["", ""]]);
  const usedByParent = new Map<string, Set<string>>();
  for (const directory of [...directories].sort((left, right) => {
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
  page: KnowledgeExportPage,
  sourceVaultPath: string,
  pagePaths: Map<string, string>,
  pagePathsByKnowledgePath: Map<string, string>,
  assetPaths: Map<string, string>,
): string {
  let body = normalizeInternalPageLinks(page.body_markdown).replace(
    PAGE_REFERENCE,
    (_match, prefix: string, label: string, id: string) => {
      const target = pagePaths.get(id.toLowerCase());
      return target
        ? `${prefix}[${label}](${markdownTarget(sourceVaultPath, target)})`
        : label || "Missing page";
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
      const parent = page.current_path.split("/").slice(0, -1).join("/");
      const candidates = path.includes("/") ? [path] : [parent ? `${parent}/${path}` : path, path];
      const target = candidates.map((candidate) => pagePathsByKnowledgePath.get(candidate)).find(Boolean);
      const label = rawLabel?.trim() || path.split("/").at(-1) || path;
      return target ? `[${label}](${markdownTarget(sourceVaultPath, target)})` : label;
    },
  );
  return body;
}

export function planKnowledgeExport(snapshot: KnowledgeExportSnapshot): PlannedKnowledgeExport {
  const items = [
    ...snapshot.pages.map((page) => ({ kind: "page" as const, id: page.id, path: page.current_path, page })),
    ...snapshot.assets.map((asset) => ({ kind: "asset" as const, id: asset.id, path: asset.current_path, asset })),
  ].sort((left, right) => left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
  const directories = knowledgeDirectories(items.map(({ path }) => path));
  const used = new Set<string>([...directories.values()].filter(Boolean).map(collisionKey));
  const pagePaths = new Map<string, string>();
  const pagePathsByKnowledgePath = new Map<string, string>();
  const assetPaths = new Map<string, string>();

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
    pages: snapshot.pages.map((page) => {
      const vaultPath = pagePaths.get(page.id.toLowerCase())!;
      return {
        ...page,
        vaultPath,
        body: rewriteReferences(page, vaultPath, pagePaths, pagePathsByKnowledgePath, assetPaths),
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
    zip64: true,
    useWebWorkers: false,
    keepOrder: true,
  });
  for (const page of planned.pages) {
    await zip.add(`${EXPORT_ROOT}/${page.vaultPath}`, new TextReader(page.body), {
      compressionMethod: 8,
      level: 6,
      lastModDate: ZIP_DATE,
      signal,
      zip64: true,
    });
  }
  for (const asset of planned.assets) {
    const content = new Response(await storage.read(asset.s3_object_key)).body;
    if (!content) throw new Error(`Asset content is missing for ${asset.current_path}`);
    await zip.add(`${EXPORT_ROOT}/${asset.vaultPath}`, content, {
      compressionMethod: 0,
      lastModDate: ZIP_DATE,
      signal,
      zip64: true,
    });
  }
  await zip.close(undefined, { zip64: true });
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
