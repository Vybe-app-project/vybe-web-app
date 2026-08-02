#!/usr/bin/env node

/**
 * Static web/backend contract inventory.
 *
 * This deliberately checks route existence, not controller semantics. Dynamic
 * expressions that cannot be reduced to path alternatives are printed for
 * manual review. Run from anywhere:
 *
 *   node scripts/audit-api-contracts.cjs ../vybe-backend
 */

const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');
const typescript = require('typescript');
const ts = typescript.default || typescript;

const webRoot = path.resolve(__dirname, '..');
const backendRoot = path.resolve(
  process.argv[2] || path.join(webRoot, '..', 'vybe-backend'),
);
const requestMethods = new Set(['get', 'post', 'put', 'patch', 'delete']);
const socketMethods = new Set(['on', 'off', 'emit']);
const dynamicMarker = '__DYNAMIC__';
const snapshotPath = path.join(webRoot, 'contracts', 'backend-routes.json');
const writeSnapshot = process.argv.includes('--write-backend-snapshot');

function walk(directory, predicate) {
  const results = [];
  if (!fs.existsSync(directory)) return results;
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(absolute, predicate));
    } else if (predicate(absolute)) {
      results.push(absolute);
    }
  }
  return results;
}

function relativeToWeb(filename) {
  return path.relative(webRoot, filename).split(path.sep).join('/');
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function collectBindings(sourceFile) {
  const bindings = new Map();
  function visit(node) {
    if (ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer) {
      const declarations = bindings.get(node.name.text) || [];
      declarations.push({
        position: node.getStart(sourceFile),
        initializer: node.initializer,
      });
      bindings.set(node.name.text, declarations);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return bindings;
}

function resolveEndpoint(node, bindings, seen = new Set()) {
  if (!node) return [];
  if (ts.isStringLiteralLike(node)) return [node.text];

  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) {
      value += dynamicMarker + span.literal.text;
    }
    return [value];
  }

  if (ts.isParenthesizedExpression(node)) {
    return resolveEndpoint(node.expression, bindings, seen);
  }

  if (ts.isConditionalExpression(node)) {
    return [
      ...resolveEndpoint(node.whenTrue, bindings, seen),
      ...resolveEndpoint(node.whenFalse, bindings, seen),
    ];
  }

  if (ts.isBinaryExpression(node)
    && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = resolveEndpoint(node.left, bindings, seen);
    const right = resolveEndpoint(node.right, bindings, seen);
    if (!left.length && !right.length) return [];
    if (!left.length) return right.map(value => dynamicMarker + value);
    if (!right.length) return left.map(value => value + dynamicMarker);
    return left.flatMap(a => right.map(b => a + b));
  }

  if (ts.isIdentifier(node)) {
    if (seen.has(node.text)) return [];
    const declarations = bindings.get(node.text) || [];
    const declaration = declarations
      .filter(candidate => candidate.position < node.getStart())
      .sort((a, b) => b.position - a.position)[0];
    if (!declaration) return [];
    const nextSeen = new Set(seen);
    nextSeen.add(node.text);
    return resolveEndpoint(declaration.initializer, bindings, nextSeen);
  }

  return [];
}

function inferBasePath(node, sourceFile) {
  if (!node) return null;
  const expression = node.getText(sourceFile);
  if (/\bORIGIN_BASE\b/.test(expression)) return '';
  if (/\bAPI_BASE\b/.test(expression)) return '/api';

  if (ts.isStringLiteralLike(node)) {
    const value = node.text.trim();
    if (!value) return '';
    if (/^https?:\/\//i.test(value)) {
      try {
        return new URL(value).pathname.replace(/\/+$/, '') || '';
      } catch {
        return null;
      }
    }
    return `/${value}`.replace(/\/+/g, '/').replace(/\/$/, '');
  }

  return null;
}

function axiosCreateBasePath(call, sourceFile, fallback) {
  const config = call.arguments[0];
  if (!config || !ts.isObjectLiteralExpression(config)) return fallback;
  const baseUrl = config.properties.find(property => (
    ts.isPropertyAssignment(property)
    && (
      (ts.isIdentifier(property.name) && property.name.text === 'baseURL')
      || (ts.isStringLiteralLike(property.name) && property.name.text === 'baseURL')
    )
  ));
  if (!baseUrl || !ts.isPropertyAssignment(baseUrl)) return fallback;
  return inferBasePath(baseUrl.initializer, sourceFile);
}

function clientIdentifiers(sourceFile) {
  const identifiers = new Map();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)
      || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const moduleName = statement.moduleSpecifier.text;
    const isClientModule = moduleName === 'axios'
      || /(?:^|\/)lib\/api$/.test(moduleName);
    if (isClientModule && statement.importClause?.name) {
      identifiers.set(statement.importClause.name.text, {
        basePath: moduleName === 'axios' ? null : '/api',
      });
    }
    const named = statement.importClause?.namedBindings;
    if (isClientModule && named && ts.isNamedImports(named)) {
      for (const element of named.elements) {
        const imported = element.propertyName?.text || element.name.text;
        if (imported === 'api' || imported === 'adminApi') {
          identifiers.set(element.name.text, {basePath: '/api'});
        }
      }
    }
  }

  // Include Axios instances and retain whether each one targets /api or the origin.
  function visit(node) {
    if (ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
      && ts.isCallExpression(node.initializer)
      && ts.isPropertyAccessExpression(node.initializer.expression)
      && node.initializer.expression.name.text === 'create'
      && ts.isIdentifier(node.initializer.expression.expression)
      && identifiers.has(node.initializer.expression.expression.text)) {
      const parent = identifiers.get(node.initializer.expression.expression.text);
      identifiers.set(node.name.text, {
        basePath: axiosCreateBasePath(node.initializer, sourceFile, parent.basePath),
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return identifiers;
}

function inventoryWeb() {
  const files = walk(
    path.join(webRoot, 'src'),
    filename => /\.(?:ts|tsx)$/.test(filename) && !filename.endsWith('.d.ts'),
  );
  const calls = [];
  const socketCalls = [];
  const fetchCalls = [];

  for (const filename of files) {
    const sourceText = fs.readFileSync(filename, 'utf8');
    const sourceFile = ts.createSourceFile(
      filename,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const clients = clientIdentifiers(sourceFile);
    const bindings = collectBindings(sourceFile);

    function visit(node) {
      if (ts.isCallExpression(node)) {
        if (ts.isIdentifier(node.expression) && node.expression.text === 'fetch') {
          fetchCalls.push({
            file: relativeToWeb(filename),
            line: lineOf(sourceFile, node),
            expression: node.arguments[0]?.getText(sourceFile) || '<missing>',
          });
        }

        if (ts.isPropertyAccessExpression(node.expression)) {
          const method = node.expression.name.text.toLowerCase();
          const owner = node.expression.expression;
          const ownerText = owner.getText(sourceFile);

          if (requestMethods.has(method)
            && ts.isIdentifier(owner)
            && clients.has(owner.text)) {
            const endpoints = resolveEndpoint(node.arguments[0], bindings);
            const client = clients.get(owner.text);
            calls.push({
              file: relativeToWeb(filename),
              line: lineOf(sourceFile, node),
              method: method.toUpperCase(),
              basePath: client.basePath,
              endpoints: [...new Set(endpoints)],
              expression: node.arguments[0]?.getText(sourceFile) || '<missing>',
            });
          }

          if (socketMethods.has(method) && /socket/i.test(ownerText)) {
            const events = resolveEndpoint(node.arguments[0], bindings);
            socketCalls.push({
              file: relativeToWeb(filename),
              line: lineOf(sourceFile, node),
              operation: method,
              event: events[0] || node.arguments[0]?.getText(sourceFile) || '<dynamic>',
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }

  const byLocation = (a, b) => a.file.localeCompare(b.file) || a.line - b.line;
  calls.sort(byLocation);
  socketCalls.sort(byLocation);
  fetchCalls.sort(byLocation);
  return {calls, socketCalls, fetchCalls};
}

function joinRoute(mount, route) {
  const combined = `${mount.replace(/\/+$/, '')}/${route.replace(/^\/+/, '')}`;
  return combined.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

function inventoryBackendSource() {
  const appPath = path.join(backendRoot, 'app.js');
  if (!fs.existsSync(appPath)) {
    return null;
  }
  const appSource = fs.readFileSync(appPath, 'utf8');
  const routes = [];
  const directRoutePattern = /app\s*\.\s*(get|post|put|patch|delete)\s*\(\s*(['"])([^'"]*)\2/g;
  let match;
  while ((match = directRoutePattern.exec(appSource))) {
    routes.push({
      method: match[1].toUpperCase(),
      path: match[3] || '/',
      file: 'app.js',
      order: routes.length,
    });
  }

  const mounts = [];
  const mountPattern = /app\.use\(\s*(['"])(\/api[^'"]*)\1\s*,\s*require\(\s*(['"])(\.\/routes\/[^'"]+)\3\s*\)/g;
  while ((match = mountPattern.exec(appSource))) {
    mounts.push({
      prefix: match[2],
      routeFile: path.resolve(backendRoot, `${match[4]}.js`),
    });
  }

  const routePattern = /router\s*\.\s*(get|post|put|patch|delete)\s*\(\s*(['"])([^'"]*)\2/g;
  for (const mount of mounts) {
    if (!fs.existsSync(mount.routeFile)) continue;
    const source = fs.readFileSync(mount.routeFile, 'utf8');
    while ((match = routePattern.exec(source))) {
      routes.push({
        method: match[1].toUpperCase(),
        path: joinRoute(mount.prefix, match[3]),
        file: path.relative(backendRoot, mount.routeFile).split(path.sep).join('/'),
        order: routes.length,
      });
    }
  }
  return routes;
}

function routeContract(routes) {
  return routes.map(({method, path: routePath, file, order}) => ({
    method,
    path: routePath,
    file,
    order,
  }));
}

function readBackendSnapshot() {
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(
      `Backend route snapshot not found at ${snapshotPath}. `
      + 'Run npm run contracts:snapshot with the backend checkout present.',
    );
  }
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.routes)) {
    throw new Error(`Unsupported backend route snapshot at ${snapshotPath}`);
  }
  return snapshot;
}

function backendRevision() {
  try {
    return execFileSync('git', ['-C', backendRoot, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function writeBackendSnapshot(routes) {
  fs.mkdirSync(path.dirname(snapshotPath), {recursive: true});
  fs.writeFileSync(snapshotPath, `${JSON.stringify({
    schemaVersion: 1,
    backendRevision: backendRevision(),
    routes: routeContract(routes),
  }, null, 2)}\n`);
  console.log(`Wrote ${routes.length} backend routes to ${snapshotPath}`);
}

function inventoryBackendRoutes() {
  const sourceRoutes = inventoryBackendSource();
  if (writeSnapshot) {
    if (!sourceRoutes) {
      throw new Error(`Backend app.js not found at ${path.join(backendRoot, 'app.js')}`);
    }
    writeBackendSnapshot(sourceRoutes);
    return sourceRoutes;
  }

  const snapshot = readBackendSnapshot();
  if (!sourceRoutes) return snapshot.routes;

  const actual = JSON.stringify(routeContract(sourceRoutes));
  const recorded = JSON.stringify(routeContract(snapshot.routes));
  if (actual !== recorded) {
    throw new Error(
      'Backend routes changed after contracts/backend-routes.json was generated. '
      + 'Review the change and run npm run contracts:snapshot.',
    );
  }
  return sourceRoutes;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function routeRegex(routePath) {
  const segments = routePath.split('/').filter(Boolean);
  const body = segments.map(segment => {
    if (segment === '*') return '.*';
    if (segment.startsWith(':')) {
      return segment.endsWith('?') ? '(?:[^/]+)?' : '[^/]+';
    }
    return escapeRegex(segment);
  }).join('/');
  return new RegExp(`^/${body}/?$`);
}

function normalizeWebEndpoint(endpoint, basePath) {
  const withoutQuery = endpoint.split(/[?#]/)[0];
  if (/^https?:\/\//i.test(withoutQuery)) {
    try {
      return new URL(withoutQuery).pathname || '/';
    } catch {
      return null;
    }
  }
  if (basePath === null) return null;
  return joinRoute(basePath, withoutQuery);
}

function matchesRoute(call, endpoint, routes) {
  const normalized = normalizeWebEndpoint(endpoint, call.basePath);
  if (!normalized) return false;
  return routes.some(route => route.method === call.method
    && routeRegex(route.path).test(normalized));
}

function routeSpecificity(routePath) {
  return routePath
    .split('/')
    .filter(Boolean)
    .reduce((score, segment) => score + (segment.startsWith(':') || segment === '*' ? 0 : 1), 0);
}

function printGroupedCalls(calls) {
  let currentFile = null;
  for (const call of calls) {
    if (call.file !== currentFile) {
      currentFile = call.file;
      console.log(`\n${currentFile}`);
    }
    const endpoint = call.endpoints.length
      ? call.endpoints.join(' | ')
      : `<dynamic: ${call.expression}>`;
    console.log(`  ${call.line}: ${call.method} ${endpoint}`);
  }
}

function main() {
  const routes = inventoryBackendRoutes();
  if (writeSnapshot) return;
  const {calls, socketCalls, fetchCalls} = inventoryWeb();
  const dynamicCalls = calls.filter(call => call.endpoints.length === 0);
  const unmatched = [];
  const unresolvedBases = [];
  const shadowed = [];

  for (const call of calls) {
    for (const endpoint of call.endpoints) {
      const normalized = normalizeWebEndpoint(endpoint, call.basePath);
      if (!normalized) {
        unresolvedBases.push({...call, endpoint});
        continue;
      }
      const matching = routes.filter(route => route.method === call.method
        && routeRegex(route.path).test(normalized));
      if (!matchesRoute(call, endpoint, routes)) {
        unmatched.push({...call, endpoint: normalized});
        continue;
      }
      const first = matching[0];
      const mostSpecific = matching
        .slice()
        .sort((a, b) => routeSpecificity(b.path) - routeSpecificity(a.path))[0];
      if (first && mostSpecific
        && routeSpecificity(mostSpecific.path) > routeSpecificity(first.path)) {
        shadowed.push({
          ...call,
          endpoint: normalized,
          firstRoute: first,
          intendedRoute: mostSpecific,
        });
      }
    }
  }

  const summary = {
    webAxiosCalls: calls.length,
    staticallyResolvedCalls: calls.length - dynamicCalls.length,
    dynamicCalls: dynamicCalls.length,
    mountedBackendRoutes: routes.length,
    unmatchedStaticEndpoints: unmatched.length,
    unresolvedClientBases: unresolvedBases.length,
    shadowedStaticEndpoints: shadowed.length,
    webSocketOperations: socketCalls.length,
    directFetchCalls: fetchCalls.length,
  };

  console.log(JSON.stringify(summary, null, 2));
  console.log('\nHTTP call inventory');
  printGroupedCalls(calls);

  console.log('\nSocket operation inventory');
  for (const operation of socketCalls) {
    console.log(
      `${operation.file}:${operation.line} ${operation.operation.toUpperCase()} ${operation.event}`,
    );
  }

  console.log('\nDirect fetch inventory');
  for (const call of fetchCalls) {
    console.log(`${call.file}:${call.line} FETCH ${call.expression}`);
  }

  if (dynamicCalls.length) {
    console.log('\nManual-review dynamic HTTP expressions');
    for (const call of dynamicCalls) {
      console.log(`${call.file}:${call.line} ${call.method} ${call.expression}`);
    }
  }

  if (unmatched.length) {
    console.error('\nUnmatched static endpoints');
    for (const call of unmatched) {
      console.error(`${call.file}:${call.line} ${call.method} ${call.endpoint}`);
    }
  }

  if (unresolvedBases.length) {
    console.error('\nHTTP calls with an unresolved Axios base URL');
    for (const call of unresolvedBases) {
      console.error(`${call.file}:${call.line} ${call.method} ${call.endpoint}`);
    }
  }

  if (shadowed.length) {
    console.error('\nShadowed static endpoints');
    for (const call of shadowed) {
      console.error(
        `${call.file}:${call.line} ${call.method} ${call.endpoint}`
        + ` first matches ${call.firstRoute.path} before ${call.intendedRoute.path}`,
      );
    }
  }

  if (dynamicCalls.length || unmatched.length || unresolvedBases.length || shadowed.length) {
    process.exitCode = 1;
  } else {
    console.log('\nPASS: every web HTTP endpoint resolves statically to a mounted backend route.');
  }
}

main();
