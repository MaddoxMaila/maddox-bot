import { minimatch } from "minimatch";
import { z } from "zod";
import { readFileWithHash, walkFiles, writeFileEnsuringDir } from "../repoFileWalker.js";
import type { ToolDefinition } from "../toolDefinition.js";

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".pdf",
  ".zip",
  ".woff",
  ".woff2",
]);

function isLikelyTextFile(path: string): boolean {
  const dot = path.lastIndexOf(".");
  return dot === -1 || !BINARY_EXTENSIONS.has(path.slice(dot));
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

interface SearchHit {
  path: string;
  line: number;
  text: string;
}

/** A whole-word, case-sensitive substring search across text files — not an AST/semantic search.
 * Good enough for a Planner to locate likely-relevant files; not a language server. */
async function searchFiles(
  baseDir: string,
  query: string,
  glob: string | undefined,
  maxResults: number,
): Promise<SearchHit[]> {
  const files = (await walkFiles(baseDir)).filter(
    (path) => isLikelyTextFile(path) && (glob === undefined || minimatch(path, glob)),
  );
  const hits: SearchHit[] = [];

  for (const path of files) {
    if (hits.length >= maxResults) {
      break;
    }
    let content: string;
    try {
      content = (await readFileWithHash(baseDir, path)).content;
    } catch {
      continue; // unreadable (e.g. a symlink to nowhere) — skip rather than fail the whole search
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length && hits.length < maxResults; i++) {
      const line = lines[i] ?? "";
      if (line.includes(query)) {
        hits.push({ path, line: i + 1, text: line.trim() });
      }
    }
  }
  return hits;
}

function definitionPatterns(symbol: string): RegExp[] {
  const escaped = escapeRegExp(symbol);
  return [
    new RegExp(String.raw`\b(function|class|interface|type)\s+${escaped}\b`),
    new RegExp(String.raw`\b(const|let|var)\s+${escaped}\s*=`),
    new RegExp(String.raw`\bdef\s+${escaped}\s*\(`), // Python
  ];
}

const searchInputSchema = z.object({
  query: z.string().min(1),
  glob: z.string().optional(),
  maxResults: z.number().int().positive().max(500).optional(),
});

const readFileInputSchema = z.object({ path: z.string().min(1) });

const listFilesInputSchema = z.object({
  path: z.string().optional(),
  recursive: z.boolean().optional(),
});

const findReferencesInputSchema = z.object({
  symbol: z.string().min(1),
  maxResults: z.number().int().positive().max(500).optional(),
});

const findDefinitionInputSchema = z.object({ symbol: z.string().min(1) });

const writeFileInputSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  /** The `sha` from a prior repo.read_file call on this path. Omit to create a new file or
   * overwrite unconditionally; when given, the write is rejected if the file's current content
   * (or absence) no longer matches — the file changed since it was last read. */
  expectedSha: z.string().optional(),
});

/** Since increment 11. Kept separate from createRepoWriteTools() so a role like the Planner can be
 * registered with read tools only. */
export function createRepoReadTools(baseDir: string): ToolDefinition[] {
  const search: ToolDefinition<z.infer<typeof searchInputSchema>> = {
    name: "repo.search",
    description:
      "Search text content across the repository (whole-word substring match, not semantic).",
    inputSchema: searchInputSchema,
    async execute(input) {
      const hits = await searchFiles(baseDir, input.query, input.glob, input.maxResults ?? 50);
      return { ok: true, output: hits };
    },
  };

  const readFile: ToolDefinition<z.infer<typeof readFileInputSchema>> = {
    name: "repo.read_file",
    description: "Read a file's content and a content hash (for future write staleness checks).",
    inputSchema: readFileInputSchema,
    async execute(input) {
      try {
        return { ok: true, output: await readFileWithHash(baseDir, input.path) };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "read_failed",
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
  };

  const listFiles: ToolDefinition<z.infer<typeof listFilesInputSchema>> = {
    name: "repo.list_files",
    description:
      "List files under a path (recursive by default), skipping node_modules/.git/dist/build/coverage.",
    inputSchema: listFilesInputSchema,
    async execute(input) {
      const subPath = input.path ?? ".";
      const recursive = input.recursive ?? true;
      const files = await walkFiles(baseDir, subPath);
      if (recursive) {
        return { ok: true, output: files };
      }
      const prefix = subPath === "." ? "" : `${subPath}/`;
      const direct = files.filter((path) => {
        const rest = path.startsWith(prefix) ? path.slice(prefix.length) : path;
        return !rest.includes("/");
      });
      return { ok: true, output: direct };
    },
  };

  const findReferences: ToolDefinition<z.infer<typeof findReferencesInputSchema>> = {
    name: "repo.find_references",
    description: "Find lines mentioning a symbol as a whole word — text-based, not semantic.",
    inputSchema: findReferencesInputSchema,
    async execute(input) {
      const wholeWord = new RegExp(String.raw`\b${escapeRegExp(input.symbol)}\b`);
      const hits = await searchFiles(baseDir, input.symbol, undefined, 2000);
      const filtered = hits
        .filter((hit) => wholeWord.test(hit.text))
        .slice(0, input.maxResults ?? 50);
      return { ok: true, output: filtered };
    },
  };

  const findDefinition: ToolDefinition<z.infer<typeof findDefinitionInputSchema>> = {
    name: "repo.find_definition",
    description:
      "Find the first line that looks like a declaration of a symbol — a heuristic, not real semantic analysis.",
    inputSchema: findDefinitionInputSchema,
    async execute(input) {
      const patterns = definitionPatterns(input.symbol);
      const hits = await searchFiles(baseDir, input.symbol, undefined, 2000);
      const match = hits.find((hit) => patterns.some((pattern) => pattern.test(hit.text)));
      return { ok: true, output: match ?? null };
    },
  };

  return [search, readFile, listFiles, findReferences, findDefinition];
}

/** Added in increment 13, alongside the Implementation Agent — the only role that gets it. */
export function createRepoWriteTools(baseDir: string): ToolDefinition[] {
  const writeFileTool: ToolDefinition<z.infer<typeof writeFileInputSchema>> = {
    name: "repo.write_file",
    description:
      "Write a file's content, creating intermediate directories as needed. Pass expectedSha " +
      "(from a prior repo.read_file) to reject the write if the file changed since it was read.",
    inputSchema: writeFileInputSchema,
    async execute(input) {
      if (input.expectedSha !== undefined) {
        const current = await readFileWithHash(baseDir, input.path).catch(() => null);
        if (current?.sha !== input.expectedSha) {
          return {
            ok: false,
            error: {
              code: "stale_write",
              message: `"${input.path}" has changed since it was last read — re-read it before writing.`,
            },
          };
        }
      }
      try {
        const { sha } = await writeFileEnsuringDir(baseDir, input.path, input.content);
        return { ok: true, output: { path: input.path, sha } };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "write_failed",
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
  };

  return [writeFileTool];
}
