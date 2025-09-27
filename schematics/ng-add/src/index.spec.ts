import { HostTree } from '@angular-devkit/schematics';
import { SchematicTestRunner, UnitTestTree } from '@angular-devkit/schematics/testing';
import { join } from 'node:path';

describe('ng-add schematic', () => {
  const collectionPath = join(__dirname, '../collection.json');
  const runner = new SchematicTestRunner('@ng2-idle-timeout/schematics', collectionPath);

  const basePackageJson = {
    name: 'workspace',
    version: '0.0.0',
    dependencies: {
      '@angular/core': '17.3.0'
    }
  };

  function createTree(): UnitTestTree {
    const host = new HostTree();
    host.create('package.json', JSON.stringify(basePackageJson, null, 2));
    host.create(
      'src/app/app.config.ts',
      "import { ApplicationConfig } from '@angular/core';\n" +
        "import { provideRouter } from '@angular/router';\n" +
        "import { routes } from './app.routes';\n\n" +
        'export const appConfig: ApplicationConfig = {\n' +
        '  providers: [\n' +
        '    provideRouter(routes)\n' +
        '  ]\n' +
        '};\n'
    );
    return new UnitTestTree(host);
  }

  it('adds the library dependency and creates the providers file', async () => {
    const tree = createTree();
    const result = await runner.runSchematic('ng-add', {}, tree);

    const pkg = JSON.parse(result.readContent('package.json')) as Record<string, unknown> & {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies['ng2-idle-timeout']).toBe('^0.1.0');

    const providersContent = result.readContent('src/app/session-timeout.providers.ts');
    expect(providersContent).toContain('sessionTimeoutProviders');
    expect(providersContent).toContain('SessionTimeoutService');
  });

  it('wires sessionTimeoutProviders into app.config.ts', async () => {
    const tree = createTree();
    const result = await runner.runSchematic('ng-add', {}, tree);

    const configContent = result.readContent('src/app/app.config.ts');
    expect(configContent).toContain("import { sessionTimeoutProviders } from './session-timeout.providers';");
    expect(configContent).toContain('...sessionTimeoutProviders');
  });
});
