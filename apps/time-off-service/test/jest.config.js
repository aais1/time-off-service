module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '../',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest'
  },
  collectCoverageFrom: ['../**/*.(t|j)s'],
  coverageDirectory: '../../coverage/apps/time-off-service',
  testEnvironment: 'node',
  roots: ['<rootDir>/test', '<rootDir>/src']
};
