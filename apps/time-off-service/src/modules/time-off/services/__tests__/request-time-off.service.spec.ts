/// <reference types="jest" />
// uuid is distributed as ESM; mock it before importing modules that import uuid to avoid Jest transform issues.
jest.mock('uuid', () => ({ v4: () => 'fixed-uuid' }));
const { RequestTimeOffService } = require('../request-time-off.service');
const { RequestStatus } = require('../../domain/entities/request.entity');
import { DataSource } from 'typeorm';

describe('RequestTimeOffService', () => {
  let service: any;
  let balanceRepo: any;
  let requestRepo: any;
  let hcmAdapter: any;
  let dataSource: any;

  beforeEach(() => {
    balanceRepo = {
      getBalance: jest.fn(),
      updateBalance: jest.fn(),
    };

    const saved: any = {};
    requestRepo = {
      findByIdempotencyKey: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation(async (req: any) => { saved[req.id] = req; return req; }),
      findById: jest.fn().mockImplementation(async (id: string) => saved[id]),
    };

    hcmAdapter = {
      submitTimeOffRequest: jest.fn(),
    };

    // QueryRunner mock used by createPendingRequest
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
      createQueryRunner: jest.fn().mockReturnValue(queryRunner as any),
    } as unknown as DataSource;

  service = new RequestTimeOffService(balanceRepo, requestRepo, hcmAdapter, dataSource);
  });

  it('approves when HCM returns approved', async () => {
    // Arrange
    const balance = { employeeId: 'emp1', locationId: 'loc1', amount: 10, deduct: jest.fn() };
    balanceRepo.getBalance.mockResolvedValue(balance);
    hcmAdapter.submitTimeOffRequest.mockResolvedValue({ status: 'approved', hcmReferenceId: 'hcm-123' });

    // Act
    const result = await service.execute({ employeeId: 'emp1', locationId: 'loc1', days: 2, idempotencyKey: 'key-1' });

    // Assert
    expect(result.status).toBe(RequestStatus.APPROVED);
    expect(result.hcmReferenceId).toBe('hcm-123');
    expect(balance.deduct).toHaveBeenCalledWith(2);
    expect(hcmAdapter.submitTimeOffRequest).toHaveBeenCalled();
  });

  it('rejects when HCM returns rejected business response', async () => {
    const balance = { employeeId: 'emp1', locationId: 'loc1', amount: 10, deduct: jest.fn() };
    balanceRepo.getBalance.mockResolvedValue(balance);
    hcmAdapter.submitTimeOffRequest.mockResolvedValue({ status: 'rejected', error: 'insufficient' });

    const result = await service.execute({ employeeId: 'emp1', locationId: 'loc1', days: 2, idempotencyKey: 'key-2' });

    expect(result.status).toBe(RequestStatus.REJECTED);
    expect(result.lastError).toBe('insufficient');
    expect(hcmAdapter.submitTimeOffRequest).toHaveBeenCalled();
  });

  it('marks retrying when HCM throws a technical error', async () => {
    const balance = { employeeId: 'emp1', locationId: 'loc1', amount: 10, deduct: jest.fn() };
    balanceRepo.getBalance.mockResolvedValue(balance);
    hcmAdapter.submitTimeOffRequest.mockRejectedValue(new Error('network error'));

    const result = await service.execute({ employeeId: 'emp1', locationId: 'loc1', days: 2, idempotencyKey: 'key-3' });

    expect(result.status).toBe(RequestStatus.RETRYING);
    expect(result.lastError).toBeDefined();
    expect(hcmAdapter.submitTimeOffRequest).toHaveBeenCalled();
  });
});
