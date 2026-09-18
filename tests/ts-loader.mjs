/**
 * ESM loader hook that lets `node --test` import the app's TypeScript modules
 * directly, so the same source the bundle ships can be unit tested (pure logic
 * under src/lib) and render tested (components, via react-dom/server) with no
 * separate build step and no test-only copy.
 *
 * `.ts` and `.tsx` files are transpiled (type stripping plus the automatic JSX
 * runtime, via the TypeScript compiler already present as a dev dependency);
 * everything else falls through to Node's default loader. Vite's
 * `import.meta.env` does not exist under Node, so reads of it resolve to an
 * empty object instead of throwing. Register from a test with:
 *
 *   import { register } from 'node:module';
 *   register('./ts-loader.mjs', import.meta.url);
 */

import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const isTypeScript = (url) => /\.tsx?$/.test(url);
// The bundler's resolution order for an extensionless relative import.
const CANDIDATES = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL && isTypeScript(context.parentURL) && /^\.\.?\//.test(specifier) && !/\.[a-z]+$/i.test(specifier)) {
    for (const extension of CANDIDATES) {
      const candidate = new URL(`${specifier}${extension}`, context.parentURL);
      try {
        await access(fileURLToPath(candidate));
        return { url: candidate.href, shortCircuit: true };
      } catch {
        // Try the next extension, then fall through to the default resolver.
      }
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
      jsx: ts.JsxEmit.ReactJSX,
      isolatedModules: true,
    },
  });
  return {
    format: 'module',
    source: outputText.replace(/\bimport\.meta\.env\b/g, '(import.meta.env ?? {})'),
    shortCircuit: true,
  };
}
