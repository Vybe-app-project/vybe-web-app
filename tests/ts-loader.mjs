/**
 * ESM loader hook that lets `node --test` import the app's TypeScript modules
 * directly, so pure logic under src/lib can be unit tested against the same
 * source the bundle ships, with no separate build step and no test-only copy.
 *
 * Only `.ts` files are transpiled (type-stripping via the TypeScript compiler
 * already present as a dev dependency); everything else falls through to
 * Node's default loader. Register from a test with:
 *
 *   import { register } from 'node:module';
 *   register('./ts-loader.mjs', import.meta.url);
 */

import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const isTypeScript = (url) => /\.ts$/.test(url);

export async function resolve(specifier, context, nextResolve) {
  // Extensionless relative imports inside a .ts module resolve to .ts first,
  // matching the bundler's resolution so shared modules can import each other.
  if (context.parentURL && isTypeScript(context.parentURL) && /^\.\.?\//.test(specifier) && !/\.[a-z]+$/i.test(specifier)) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    try {
      await access(fileURLToPath(candidate));
      return { url: candidate.href, shortCircuit: true };
    } catch {
      // Fall through to the default resolver.
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (!isTypeScript(url)) return nextLoad(url, context);
  const source = await readFile(fileURLToPath(url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    fileName: fileURLToPath(url),
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      isolatedModules: true,
    },
  });
  return { format: 'module', source: outputText, shortCircuit: true };
}
