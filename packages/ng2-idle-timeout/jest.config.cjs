const { pathsToModuleNameMapper } = require('ts-jest');
const { compilerOptions } = require('../../tsconfig.base.json');

module.exports = {
  preset: 'jest-preset-angular',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  collectCoverage: true,
  coverageDirectory: '<rootDir>/coverage',
  testEnvironmentOptions: {
    customExportConditions: ['browser', 'module', 'default']
  },
  coverageThreshold: {
    global: {
      statements: 60,
      branches: 30,
      functions: 45,
      lines: 60
    }
  },
  transform: {
    '^.+\.(ts|mjs|js|html)$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\.(html|svg)$'
      }
    ]
  },
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths || {}, {
    prefix: '<rootDir>/'
  }),
  transformIgnorePatterns: ['node_modules/(?!(@angular|rxjs|tslib)/)'],
  testMatch: ['**/?(*.)+(spec).ts']
};
