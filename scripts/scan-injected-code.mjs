#!/usr/bin/env node
/**
 * Supply-chain guard: detects code hidden in source and assets.
 *
 * Written 2026-09-17 after an obfuscated remote-code-execution loader was
 * found appended to six build configs and smuggled inside three fake .woff2
 * "font" files across the Vybe repositories. The payload sat behind ~270-500
 * characters of whitespace on the last line of an otherwise ordinary config,
 * so it fell off the right edge of an editor and was invisible in review and
 * in GitHub's diff view. It executed whenever babel, vite, tailwind, jest or
 * metro loaded the config -- i.e. on `npm test`, `npm run build`, `npm run
 * verify`, or a Metro start.
 *
 * This runs with no dependencies so a pre-commit hook and CI can both use it.
 *
 * Usage:
 *   node scripts/scan-injected-code.mjs                # scan the repo
 *   node scripts/scan-injected-code.mjs --staged       # scan git-staged files
 *   node scripts/scan-injected-code.mjs path [path...] # scan specific paths
 *
 * Exits 1 when anything is flagged.
 *
 * This scanner only ever reads files as bytes and pattern-matches. It never
 * evaluates, imports, or executes the content it inspects. The indicator
 * strings below are assembled from fragments so that this file does not itself
 * contain the literals it hunts for -- otherwise the scanner would flag itself
 * and every copy of it.
 */

import { readFileSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, basename, extname, relative, resolve } from 'node:path';

const ROOT = process.cwd();

/* ------------------------------------------------------------------ *
 * Tier 1: always fatal, in every file
 * ------------------------------------------------------------------ */

/**
 * Concealment itself. A long run of spaces/tabs with real content after it on
 * the same line is the generic signal, independent of any single campaign.
 * Legitimate source code does not do this; formatters collapse it.
 */
const PADDING = /[ \t]{80,}\S/;

/**
 * Known indicators from the 2026-09-17 campaign, assembled from fragments.
 * A future variant will change these, which is why PADDING and the asset
 * magic-byte checks above matter more than this list.
 */
const IOCS = [
  ['A8-', '4466-1'],
  ['166.88.', '134.75'],
  ['0xa322E5f3D311D3080e6f01', '21063e9aDC2490Ef1a'],
  ['/0x/', 'cls'],
  ['/0x/', 'clb'],
  ['verify-', 'human/'],
  ['run_', 'loader'],
].map((parts) => parts.join(''));

/* ------------------------------------------------------------------ *
 * Tier 2: fatal inside build-config files only
 *
 * A build config is declarative. It has no business spawning processes,
 * decrypting buffers, or talking to a blockchain. Application code sometimes
 * legitimately uses child_process, so these patterns are scoped to configs to
 * keep the signal clean.
 * ------------------------------------------------------------------ */
const BEHAVIOUR = [
  [/eval\s*\(\s*await/, 'eval() of an awaited (network-sourced) value'],
  [/await\s+eval\s*\(/, 'await eval()'],
  [/new\s+Function\s*\(/, 'new Function() constructor'],
  [/spawn\s*\(\s*['"]node['"]\s*,\s*\[\s*['"]-e['"]/, "spawn('node', ['-e', ...])"],
  [/detached\s*:\s*(!0|true)/, 'detached child process'],
  [/charCodeAt\s*\(\s*\w+\s*%\s*\w+\s*\)/, 'XOR-decode loop'],
  [/eth_getBlockByNumber|eth_getTransactionCount|eth_blockNumber/, 'Ethereum RPC call'],
  [/child_process/, 'child_process in a build config'],
];

const CONFIG_RE =
  /^(babel|metro|vite|tailwind|postcss|jest|next|rollup|webpack|svelte|nuxt|vue|astro|craco|karma|cypress|playwright)\.config\.(js|cjs|mjs|ts|mts|cts)$/;
const CONFIG_EXTRA = new Set([
  '.eslintrc.js',
  '.prettierrc.js',
  '.babelrc.js',
  'jest.setup.js',
  'react-native.config.js',
]);

const isConfig = (file) => CONFIG_RE.test(basename(file)) || CONFIG_EXTRA.has(basename(file));

/* ------------------------------------------------------------------ *
 * Asset validation: a "font" that is really a script
 * ------------------------------------------------------------------ */

/** Leading magic bytes each binary asset type must start with. */
const MAGIC = {
  '.woff': [[0x77, 0x4f, 0x46, 0x46]], // wOFF
  '.woff2': [[0x77, 0x4f, 0x46, 0x32]], // wOF2
  '.ttf': [
    [0x00, 0x01, 0x00, 0x00],
    [0x74, 0x72, 0x75, 0x65], // 'true'
    [0x74, 0x74, 0x63, 0x66], // 'ttcf'
    [0x4f, 0x54, 0x54, 0x4f], // 'OTTO'
  ],
  '.otf': [[0x4f, 0x54, 0x54, 0x4f], [0x00, 0x01, 0x00, 0x00]],
  '.eot': null, // EOT has no reliable leading magic; ASCII check still applies.
  '.png': [[0x89, 0x50, 0x4e, 0x47]],
  '.jpg': [[0xff, 0xd8, 0xff]],
  '.jpeg': [[0xff, 0xd8, 0xff]],
  '.gif': [[0x47, 0x49, 0x46, 0x38]],
  '.ico': [[0x00, 0x00, 0x01, 0x00]],
};
const BINARY_EXT = new Set(Object.keys(MAGIC));

/**
 * Only third-party or machine-generated trees are skipped.
 *
 * `dist/`, `build/` and `vendor/` are deliberately NOT skipped. The 2026-09-17
 * payload was found in a built `dist/fonts/` asset, and this repo carries a
 * local `vendor/` package override -- both are exactly the places an attacker
 * hides, and both are cheap to scan. Minified bundles do not trip the
 * whitespace-padding rule, because minification strips whitespace runs.
 */
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'coverage',
  'Pods',
  '.venv',
  '__pycache__',
  '.gradle',
]);

const TEXT_EXT = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts',
  '.json', '.py', '.sh', '.bash', '.zsh', '.rb', '.go', '.rs',
  '.yml', '.yaml', '.html', '.htm', '.css', '.scss', '.md', '.svg',
]);

const MAX_BYTES = 8 * 1024 * 1024;

function checkMagic(buf, ext) {
  const expected = MAGIC[ext];
  if (!expected) return true;
  return expected.some((sig) => sig.every((b, i) => buf[i] === b));
}

function scanFile(abs) {
  const out = [];
  let buf;
  try {
    const st = statSync(abs);
    if (!st.isFile() || st.size === 0) return out;
    if (st.size > MAX_BYTES) return out;
    buf = readFileSync(abs);
  } catch {
    return out;
  }

  const ext = extname(abs).toLowerCase();

  // A binary asset that is really text is a staging location for a payload.
  if (BINARY_EXT.has(ext)) {
    const sample = buf.subarray(0, 4096);
    const allAscii = sample.every((c) => c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127));
    if (allAscii) {
      out.push('binary asset contains only ASCII text (fake font/image carrying a payload)');
    } else if (!checkMagic(buf, ext)) {
      out.push(`binary asset does not start with the magic bytes for ${ext}`);
    }
  }

  // SVG is text but must still be an SVG document.
  if (ext === '.svg') {
    const head = buf.subarray(0, 512).toString('utf8').trimStart();
    if (head && !head.startsWith('<?xml') && !head.startsWith('<svg') && !head.startsWith('<!--')) {
      out.push('.svg does not begin with an XML/SVG document');
    }
  }

  let text;
  try {
    text = buf.toString('utf8');
  } catch {
    return out;
  }
  // Only inspect as text when it plausibly is text.
  if (!BINARY_EXT.has(ext) && !TEXT_EXT.has(ext) && ext !== '') return out;

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (PADDING.test(lines[i])) {
      const col = lines[i].search(/[ \t]{80,}\S/) + 1;
      out.push(`line ${i + 1}: code hidden behind a long whitespace run (column ~${col})`);
    }
  }

  for (const ioc of IOCS) {
    if (text.includes(ioc)) out.push(`contains known malware indicator: ${ioc}`);
  }

  if (isConfig(abs) || BINARY_EXT.has(ext)) {
    for (const [re, label] of BEHAVIOUR) {
      if (re.test(text)) out.push(`build config contains ${label}`);
    }
  }

  return out;
}

function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(p, acc);
    } else if (e.isFile()) {
      acc.push(p);
    }
  }
  return acc;
}

function stagedFiles() {
  try {
    return execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
      encoding: 'utf8',
    })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((f) => resolve(ROOT, f));
  } catch {
    return [];
  }
}

const args = process.argv.slice(2);
const selfPath = resolve(process.argv[1]);

let targets;
if (args.includes('--staged')) {
  targets = stagedFiles();
} else if (args.filter((a) => !a.startsWith('--')).length > 0) {
  targets = args
    .filter((a) => !a.startsWith('--'))
    .flatMap((a) => {
      const abs = resolve(ROOT, a);
      try {
        return statSync(abs).isDirectory() ? walk(abs) : [abs];
      } catch {
        return [];
      }
    });
} else {
  targets = walk(ROOT);
}

// Never flag this scanner, which necessarily describes what it detects.
targets = targets.filter((t) => resolve(t) !== selfPath);

let flagged = 0;
for (const f of targets) {
  const findings = scanFile(f);
  if (findings.length) {
    flagged++;
    console.error(`\n✗ ${relative(ROOT, f) || f}`);
    for (const d of findings) console.error(`    ${d}`);
  }
}

if (flagged) {
  console.error(
    `\n${flagged} file(s) flagged. This is how the 2026-09-17 loader was hidden:\n` +
      `code appended after a long whitespace run, or smuggled inside a fake font.\n` +
      `Inspect with:  cat -A <file> | tail -5\n` +
      `Do not bypass this check without understanding why it fired.\n`
  );
  process.exit(1);
}

console.log(`Supply-chain scan clean (${targets.length} files).`);
