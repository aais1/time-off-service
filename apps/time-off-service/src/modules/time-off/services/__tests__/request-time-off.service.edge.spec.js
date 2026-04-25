// mock uuid to avoid ESM issues
jest.mock('uuid', () => ({ v4: () => 'fixed-uuid' }));
const { RequestTimeOffService } = require('../request-time-off.service');
const { RequestStatus } = require('../../domain/entities/request.entity');

const { DataSource } = require('typeorm');

describe('RequestTimeOffService - edge cases (JS)', () => {
  let service;
  let balanceRepo;
  let requestRepo;
  let hcmAdapter;
  let dataSource;

  beforeEach(() => {
    balanceRepo = {
      getBalance: jest.fn(),
      updateBalance: jest.fn(),
    };

    const saved = {};
    requestRepo = {
      findByIdempotencyKey: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation(async (req) => { saved[req.id] = req; return req; }),
      findById: jest.fn().mockImplementation(async (id) => saved[id]),
    };

    hcmAdapter = {
      submitTimeOffRequest: jest.fn(),
    };

    const manager = {};
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager,
    };

    dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    };

    service = new RequestTimeOffService(balanceRepo, requestRepo, hcmAdapter, dataSource);
  });

  it('throws BALANCE_NOT_FOUND when no local balance', async () => {
    balanceRepo.getBalance.mockResolvedValue(null);

    await expect(service.execute({ employeeId: 'e1', locationId: 'l1', days: 1, idempotencyKey: 'k1' }))
      .rejects.toThrow('BALANCE_NOT_FOUND');
  });

  it('throws INSUFFICIENT_BALANCE when balance too low', async () => {
    const balance = { employeeId: 'e1', locationId: 'l1', amount: 0, deduct: jest.fn() };
    balanceRepo.getBalance.mockResolvedValue(balance);

    await expect(service.execute({ employeeId: 'e1', locationId: 'l1', days: 1, idempotencyKey: 'k2' }))
      .rejects.toThrow('INSUFFICIENT_BALANCE');
  });

  it('respects idempotency and returns existing request', async () => {
    const existing = { id: 'r1', status: RequestStatus.APPROVED, idempotencyKey: 'k3' };
    requestRepo.findByIdempotencyKey.mockResolvedValue(existing);

    const result = await service.execute({ employeeId: 'e1', locationId: 'l1', days: 1, idempotencyKey: 'k3' });
    expect(result).toBe(existing);
  });
});
