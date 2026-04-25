module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testRegex: '.*\\.spec\\.(ts|js)$',
  moduleFileExtensions: ['js','json','ts'],
  roots: ['<rootDir>/src', '<rootDir>/test'],
};
