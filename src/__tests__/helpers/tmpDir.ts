import { mkdir, mkdtemp } from "fs/promises";
import { resolve } from "path";

export const TEST_TMP_ROOT = resolve(__dirname, "../../../.test-tmp");

export const testTmpDir = (name: string): string =>
  resolve(TEST_TMP_ROOT, name);

export const makeTestTmpDir = async (prefix: string): Promise<string> => {
  await mkdir(TEST_TMP_ROOT, { recursive: true });
  return mkdtemp(resolve(TEST_TMP_ROOT, `${prefix}-`));
};
