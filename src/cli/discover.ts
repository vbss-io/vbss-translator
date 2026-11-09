import { readdir, stat } from "fs/promises";
import type { Dirent, Stats } from "fs";
import { isAbsolute, join, parse, resolve } from "path";

export interface FindFilesOptions {
  cwd: string;
  absolute: boolean;
}

type Step =
  | { kind: "globstar" }
  | { kind: "literal"; text: string }
  | { kind: "pattern"; regexp: RegExp; matchesDotfiles: boolean };

const IGNORED_ERROR_CODES = new Set(["ENOENT", "ENOTDIR", "EACCES", "EPERM"]);
const CASE_INSENSITIVE_PLATFORMS = new Set(["win32", "darwin"]);

const hasIgnoredCode = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  typeof error.code === "string" &&
  IGNORED_ERROR_CODES.has(error.code);

const readDirectory = async (directory: string): Promise<Dirent[]> => {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (hasIgnoredCode(error)) return [];
    throw error;
  }
};

const statPath = async (path: string): Promise<Stats | null> => {
  try {
    return await stat(path);
  } catch (error) {
    if (hasIgnoredCode(error)) return null;
    throw error;
  }
};

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");

const escapeClassBody = (text: string): string =>
  text.replace(/[\\\][^]/g, "\\$&");

const readBraceGroup = (
  pattern: string,
  start: number
): { alternatives: string[]; end: number } => {
  const alternatives: string[] = [];
  let depth = 0;
  let alternativeStart = start + 1;
  for (let index = start; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        alternatives.push(pattern.slice(alternativeStart, index));
        return { alternatives, end: index };
      }
    } else if (char === "," && depth === 1) {
      alternatives.push(pattern.slice(alternativeStart, index));
      alternativeStart = index + 1;
    }
  }
  return { alternatives, end: -1 };
};

export const expandBraces = (pattern: string): string[] => {
  const start = pattern.indexOf("{");
  if (start === -1) return [pattern];
  const { alternatives, end } = readBraceGroup(pattern, start);
  if (end === -1) return [pattern];
  const head = pattern.slice(0, start);
  const tail = pattern.slice(end + 1);
  if (alternatives.length < 2) {
    const literal = pattern.slice(start, end + 1);
    return expandBraces(tail).map((expandedTail) => head + literal + expandedTail);
  }
  return alternatives.flatMap((alternative) =>
    expandBraces(head + alternative + tail)
  );
};

const segmentToRegExp = (segment: string, caseInsensitive: boolean): RegExp => {
  let source = "";
  for (let index = 0; index < segment.length; index++) {
    const char = segment[index];
    if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else if (char === "[") {
      const close = segment.indexOf("]", index + 2);
      if (close === -1) {
        source += "\\[";
      } else {
        const body = segment.slice(index + 1, close);
        const negated = body.startsWith("!") || body.startsWith("^");
        source += `[${negated ? "^" : ""}${escapeClassBody(
          negated ? body.slice(1) : body
        )}]`;
        index = close;
      }
    } else {
      source += escapeRegExp(char);
    }
  }
  return new RegExp(`^${source}$`, caseInsensitive ? "i" : "");
};

const toSteps = (segments: string[], caseInsensitive: boolean): Step[] => {
  const steps: Step[] = [];
  for (const segment of segments) {
    if (segment === "**") {
      if (steps[steps.length - 1]?.kind !== "globstar") {
        steps.push({ kind: "globstar" });
      }
    } else if (/[*?[]/.test(segment)) {
      steps.push({
        kind: "pattern",
        regexp: segmentToRegExp(segment, caseInsensitive),
        matchesDotfiles: segment.startsWith("."),
      });
    } else {
      steps.push({ kind: "literal", text: segment });
    }
  }
  return steps;
};

const isFileEntry = async (
  directory: string,
  entry: Dirent
): Promise<boolean> => {
  if (entry.isFile()) return true;
  if (!entry.isSymbolicLink()) return false;
  return (await statPath(join(directory, entry.name)))?.isFile() ?? false;
};

const isDirectoryEntry = async (
  directory: string,
  entry: Dirent
): Promise<boolean> => {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  return (await statPath(join(directory, entry.name)))?.isDirectory() ?? false;
};

export async function findFiles(
  pattern: string,
  options: FindFilesOptions
): Promise<string[]> {
  const caseInsensitive = CASE_INSENSITIVE_PLATFORMS.has(process.platform);
  const results = new Set<string>();
  for (const expanded of expandBraces(pattern.replace(/\\/g, "/"))) {
    const root = isAbsolute(expanded) ? parse(expanded).root : "";
    const segments = expanded
      .slice(root.length)
      .split("/")
      .filter((segment) => segment !== "" && segment !== ".");
    if (segments.length === 0) continue;
    const steps = toSteps(segments, caseInsensitive);
    const emit = (directory: string, relative: string[], name: string) => {
      results.add(
        root || options.absolute
          ? resolve(directory, name)
          : [...relative, name].join("/")
      );
    };
    const walk = async (
      directory: string,
      relative: string[],
      index: number
    ): Promise<void> => {
      const step = steps[index];
      const isLast = index === steps.length - 1;
      if (step.kind === "globstar") {
        if (!isLast) await walk(directory, relative, index + 1);
        for (const entry of await readDirectory(directory)) {
          if (entry.name.startsWith(".")) continue;
          if (entry.isDirectory()) {
            await walk(
              join(directory, entry.name),
              [...relative, entry.name],
              index
            );
          } else if (isLast && (await isFileEntry(directory, entry))) {
            emit(directory, relative, entry.name);
          }
        }
        return;
      }
      if (step.kind === "literal") {
        const target = join(directory, step.text);
        const info = await statPath(target);
        if (!info) return;
        if (isLast) {
          if (info.isFile()) emit(directory, relative, step.text);
        } else if (info.isDirectory()) {
          await walk(target, [...relative, step.text], index + 1);
        }
        return;
      }
      for (const entry of await readDirectory(directory)) {
        if (!step.regexp.test(entry.name)) continue;
        if (entry.name.startsWith(".") && !step.matchesDotfiles) continue;
        if (isLast) {
          if (await isFileEntry(directory, entry)) {
            emit(directory, relative, entry.name);
          }
        } else if (await isDirectoryEntry(directory, entry)) {
          await walk(
            join(directory, entry.name),
            [...relative, entry.name],
            index + 1
          );
        }
      }
    };
    await walk(root || resolve(options.cwd), [], 0);
  }
  return [...results].sort();
}
