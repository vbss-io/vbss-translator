import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdir, writeFile, rm, symlink } from "fs/promises";
import { join, resolve } from "path";
import { expandBraces, findFiles } from "@/cli/discover";
import { makeTestTmpDir } from "@/__tests__/helpers/tmpDir";

const FIXTURE_FILES = [
  "translations.json",
  "src/translations.json",
  "src/a/translations.json",
  "src/ab/translations.json",
  "src/b/c/translations.json",
  "src/b/c/d/e/translations.json",
  "src/x/other.json",
  "src/x/more.json",
  "src/.hidden/translations.json",
  "src/.dotfile.json",
  "node_modules/pkg/src/translations.json",
  ".dot/translations.json",
  "lib/deep/translations.json",
  "other/file.json",
];

const SYMLINK_REFUSAL_CODES = ["EPERM", "EACCES", "ENOSYS", "ENOTSUP"];

const tryCreate = async (create: () => Promise<void>): Promise<string | null> => {
  try {
    await create();
    return null;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code ?? "UNKNOWN";
  }
};

describe("expandBraces", () => {
  it("returns the pattern untouched when there are no braces", () => {
    expect(expandBraces("src/**/*.json")).toEqual(["src/**/*.json"]);
  });

  it("expands a single group", () => {
    expect(expandBraces("src/{a,b}/x.json")).toEqual([
      "src/a/x.json",
      "src/b/x.json",
    ]);
  });

  it("expands nested and sequential groups", () => {
    expect(expandBraces("{a,b{1,2}}/{x,y}")).toEqual([
      "a/x",
      "a/y",
      "b1/x",
      "b1/y",
      "b2/x",
      "b2/y",
    ]);
  });

  it("keeps a group with one alternative literal and still expands the rest", () => {
    expect(expandBraces("{only}/{a,b}")).toEqual(["{only}/a", "{only}/b"]);
  });

  it("keeps an unterminated group literal", () => {
    expect(expandBraces("src/{a,b")).toEqual(["src/{a,b"]);
  });

  it("supports empty alternatives", () => {
    expect(expandBraces("a{,b}")).toEqual(["a", "ab"]);
  });
});

describe("findFiles", () => {
  let root: string;
  const find = (pattern: string, absolute = false) =>
    findFiles(pattern, { cwd: root, absolute });

  beforeEach(async () => {
    root = await makeTestTmpDir("discover");
    for (const file of FIXTURE_FILES) {
      await mkdir(join(root, file, ".."), { recursive: true });
      await writeFile(join(root, file), "[]");
    }
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("finds files at every depth with a globstar", async () => {
    expect(await find("src/**/translations.json")).toEqual([
      "src/a/translations.json",
      "src/ab/translations.json",
      "src/b/c/d/e/translations.json",
      "src/b/c/translations.json",
      "src/translations.json",
    ]);
  });

  it("lets a leading globstar match the root and traverse node_modules", async () => {
    expect(await find("**/translations.json")).toEqual([
      "lib/deep/translations.json",
      "node_modules/pkg/src/translations.json",
      "src/a/translations.json",
      "src/ab/translations.json",
      "src/b/c/d/e/translations.json",
      "src/b/c/translations.json",
      "src/translations.json",
      "translations.json",
    ]);
  });

  it("matches a wildcard inside a file name", async () => {
    expect(await find("src/x/*.json")).toEqual([
      "src/x/more.json",
      "src/x/other.json",
    ]);
  });

  it("matches a single character with a question mark", async () => {
    expect(await find("src/?/translations.json")).toEqual([
      "src/a/translations.json",
    ]);
  });

  it("matches one directory level with a star", async () => {
    expect(await find("src/*/translations.json")).toEqual([
      "src/a/translations.json",
      "src/ab/translations.json",
    ]);
  });

  it("matches character classes and negated classes", async () => {
    expect(await find("src/[ab]/translations.json")).toEqual([
      "src/a/translations.json",
    ]);
    expect(await find("src/[!a]/translations.json")).toEqual([]);
    expect(await find("src/[^b]?/translations.json")).toEqual([
      "src/ab/translations.json",
    ]);
  });

  it("treats an unterminated bracket as a literal character", async () => {
    expect(await find("src/[a/translations.json")).toEqual([]);
  });

  it("expands braces", async () => {
    expect(await find("src/{a,b}/**/translations.json")).toEqual([
      "src/a/translations.json",
      "src/b/c/d/e/translations.json",
      "src/b/c/translations.json",
    ]);
  });

  it("returns each file once when alternatives overlap", async () => {
    expect(await find("src/{a,a}/translations.json")).toEqual([
      "src/a/translations.json",
    ]);
  });

  it("collapses consecutive globstars", async () => {
    expect(await find("src/**/**/translations.json")).toEqual(
      await find("src/**/translations.json")
    );
  });

  it("returns only files when the pattern ends with a globstar", async () => {
    expect(await find("src/**")).toEqual([
      "src/a/translations.json",
      "src/ab/translations.json",
      "src/b/c/d/e/translations.json",
      "src/b/c/translations.json",
      "src/translations.json",
      "src/x/more.json",
      "src/x/other.json",
    ]);
  });

  it("returns only files when a wildcard matches directories too", async () => {
    expect(await find("src/*")).toEqual(["src/translations.json"]);
  });

  it("ignores dotfiles and dot directories for wildcards and globstars", async () => {
    const found = await find("src/**/*.json");
    expect(found).not.toContain("src/.hidden/translations.json");
    expect(found).not.toContain("src/.dotfile.json");
  });

  it("matches dot entries when the pattern segment starts with a dot", async () => {
    expect(await find("src/.*.json")).toEqual(["src/.dotfile.json"]);
    expect(await find(".dot/translations.json")).toEqual([
      ".dot/translations.json",
    ]);
    expect(await find(".*/translations.json")).toEqual([
      ".dot/translations.json",
    ]);
  });

  it("returns a literal path when the file exists", async () => {
    expect(await find("src/a/translations.json")).toEqual([
      "src/a/translations.json",
    ]);
  });

  it("returns nothing for a literal path that does not exist", async () => {
    expect(await find("src/missing/translations.json")).toEqual([]);
    expect(await find("nothing/**/*.json")).toEqual([]);
    expect(await find("nothing/*/*.json")).toEqual([]);
  });

  it("returns nothing when a literal segment is a file used as a directory", async () => {
    expect(await find("translations.json/x.json")).toEqual([]);
  });

  it("does not return a directory for a literal pattern", async () => {
    expect(await find("src/a")).toEqual([]);
  });

  it("ignores a leading dot segment and repeated separators", async () => {
    expect(await find("./src//a/translations.json")).toEqual([
      "src/a/translations.json",
    ]);
  });

  it("accepts backslash separators", async () => {
    expect(await find("src\\a\\translations.json")).toEqual([
      "src/a/translations.json",
    ]);
  });

  it("resolves parent segments against the cwd", async () => {
    const wildcard = await findFiles("../*/a/translations.json", {
      cwd: join(root, "lib"),
      absolute: false,
    });
    expect(wildcard).toEqual(["../src/a/translations.json"]);
    const parent = await findFiles("../src/a/translations.json", {
      cwd: join(root, "lib"),
      absolute: false,
    });
    expect(parent).toEqual(["../src/a/translations.json"]);
  });

  it("returns absolute paths when requested", async () => {
    expect(await find("src/a/*.json", true)).toEqual([
      resolve(root, "src/a/translations.json"),
    ]);
    expect(await find("src/**/translations.json", true)).toContain(
      resolve(root, "src/b/c/d/e/translations.json")
    );
  });

  it("supports absolute patterns and returns absolute paths", async () => {
    const pattern = join(root, "src", "a", "*.json");
    expect(await find(pattern)).toEqual([
      resolve(root, "src/a/translations.json"),
    ]);
  });

  it("returns nothing for an empty pattern", async () => {
    expect(await find("")).toEqual([]);
    expect(await find("./")).toEqual([]);
  });

  it("returns paths in a stable sorted order", async () => {
    const found = await find("**/*.json");
    expect(found).toEqual([...found].sort());
  });

  it("follows symlinked files and symlinked directories on single-level steps", async () => {
    const created = await tryCreate(async () => {
      await symlink(
        join(root, "src/a/translations.json"),
        join(root, "src/x/linked.json")
      );
      await symlink(join(root, "src/a"), join(root, "linked-dir"), "junction");
    });
    if (created !== null) {
      expect(SYMLINK_REFUSAL_CODES).toContain(created);
      expect(await find("src/x/other.json")).toEqual(["src/x/other.json"]);
      return;
    }
    expect(await find("src/x/linked.json")).toEqual(["src/x/linked.json"]);
    expect(await find("src/x/link*.json")).toEqual(["src/x/linked.json"]);
    expect(await find("src/**/link*.json")).toEqual(["src/x/linked.json"]);
    expect(await find("src/x/**")).toContain("src/x/linked.json");
    expect(await find("linked-*/translations.json")).toEqual([
      "linked-dir/translations.json",
    ]);
  });

  it("ignores broken symlinks", async () => {
    const created = await tryCreate(() =>
      symlink(
        join(root, "does-not-exist.json"),
        join(root, "src/x/broken.json")
      )
    );
    if (created !== null) {
      expect(SYMLINK_REFUSAL_CODES).toContain(created);
      expect(await find("src/x/*.json")).toEqual([
        "src/x/more.json",
        "src/x/other.json",
      ]);
      return;
    }
    expect(await find("src/x/*.json")).toEqual([
      "src/x/more.json",
      "src/x/other.json",
    ]);
  });
});
