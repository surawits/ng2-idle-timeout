import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';

interface NgAddOptions {
  project?: string;
}

const DEPENDENCY_NAME = 'ng2-idle-timeout';
const DEPENDENCY_VERSION = '^0.1.0';
const PROVIDERS_PATH = 'src/app/session-timeout.providers.ts';
const APP_CONFIG_PATH = 'src/app/app.config.ts';

export function ngAdd(_options: NgAddOptions = {}): Rule {
  return (tree: Tree, context: SchematicContext) => {
    addLibraryDependency(tree, context);
    ensureProvidersFile(tree, context);
    updateAppConfig(tree, context);
    return tree;
  };
}

export default ngAdd;

function addLibraryDependency(tree: Tree, context: SchematicContext): void {
  if (!tree.exists('package.json')) {
    context.logger.warn('package.json not found. Skipping dependency installation.');
    return;
  }

  const buffer = tree.read('package.json');
  if (!buffer) {
    context.logger.warn('package.json is empty. Skipping dependency installation.');
    return;
  }

  const packageJson = JSON.parse(buffer.toString('utf-8')) as Record<string, unknown>;
  const dependencies = (packageJson.dependencies ?? {}) as Record<string, string>;

  if (!dependencies[DEPENDENCY_NAME]) {
    dependencies[DEPENDENCY_NAME] = DEPENDENCY_VERSION;
    packageJson.dependencies = dependencies;
    tree.overwrite('package.json', JSON.stringify(packageJson, null, 2) + '\n');
    context.logger.info(`Added ${DEPENDENCY_NAME}@${DEPENDENCY_VERSION} to dependencies.`);
  } else {
    context.logger.debug(`${DEPENDENCY_NAME} already present in dependencies.`);
  }
}

function ensureProvidersFile(tree: Tree, context: SchematicContext): void {
  if (tree.exists(PROVIDERS_PATH)) {
    context.logger.debug('Providers file already present.');
    return;
  }

  const content = `import { createSessionTimeoutProviders } from 'ng2-idle-timeout';
import type { SessionTimeoutPartialConfig } from 'ng2-idle-timeout';

export const defaultSessionTimeoutConfig: SessionTimeoutPartialConfig = {
  storageKeyPrefix: 'app-session',
  resumeBehavior: 'autoOnServerSync',
  warnBeforeMs: 60000
};

export const sessionTimeoutProviders = createSessionTimeoutProviders(defaultSessionTimeoutConfig);
`;

  tree.create(PROVIDERS_PATH, content);
  context.logger.info(`Created ${PROVIDERS_PATH}.`);
}

function updateAppConfig(tree: Tree, context: SchematicContext): void {
  if (!tree.exists(APP_CONFIG_PATH)) {
    context.logger.warn('src/app/app.config.ts not found. Please wire sessionTimeoutProviders manually.');
    return;
  }

  const buffer = tree.read(APP_CONFIG_PATH);
  if (!buffer) {
    context.logger.warn('src/app/app.config.ts could not be read.');
    return;
  }

  let content = buffer.toString('utf-8');
  let mutated = false;

  if (!content.includes('session-timeout.providers')) {
    content = ensureImport(content, 'sessionTimeoutProviders', './session-timeout.providers');
    mutated = true;
  }

  if (!content.includes('...sessionTimeoutProviders')) {
    const providersIndex = content.indexOf('providers');
    if (providersIndex === -1) {
      context.logger.warn('providers array not found in app.config.ts.');
    } else {
      const bracketIndex = content.indexOf('[', providersIndex);
      if (bracketIndex === -1) {
        context.logger.warn('Unable to locate providers array brackets in app.config.ts.');
      } else {
        const insertion = '\n    ...sessionTimeoutProviders,';
        content = content.slice(0, bracketIndex + 1) + insertion + content.slice(bracketIndex + 1);
        mutated = true;
      }
    }
  }

  if (mutated) {
    tree.overwrite(APP_CONFIG_PATH, content);
    context.logger.info('Updated app.config.ts with sessionTimeoutProviders.');
  }
}

function ensureImport(source: string, symbol: string, from: string): string {
  if (source.includes(symbol) && source.includes(`from '${from}'`)) {
    return source;
  }

  const lines = source.split(/\r?\n/);
  let lastImportIndex = -1;

  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim().startsWith('import ')) {
      lastImportIndex = i;
    }
  }

  const importStatement = `import { ${symbol} } from '${from}';`;
  const insertAt = lastImportIndex >= 0 ? lastImportIndex + 1 : 0;
  lines.splice(insertAt, 0, importStatement);
  return lines.join('\n');
}
