/// <reference types="jest" />
import { StartupSyncService } from '../startup-sync.service';

jest.useFakeTimers();

describe('StartupSyncService', () => {
  let service: any;
  let hcmAdapter: any;
  let balanceSyncService: any;

  beforeEach(() => {
    hcmAdapter = {
      fetchAllBalances: jest.fn(),
      fetchBalance: jest.fn(),
    };

    balanceSyncService = {
      executeBatch: jest.fn(),
    };

    service = new StartupSyncService(hcmAdapter, balanceSyncService);
  });

  it('uses batch balances when returned', async () => {
    hcmAdapter.fetchAllBalances.mockResolvedValue([{ employeeId: 'e1', locationId: 'l1', balance: 5 }]);

    await service.onModuleInit();

    expect(balanceSyncService.executeBatch).toHaveBeenCalledWith([{ employeeId: 'e1', locationId: 'l1', balance: 5 }]);
  });

  it('falls back to per-employee bootstrap when batch is empty', async () => {
    hcmAdapter.fetchAllBalances.mockResolvedValue([]);
    // set env bootstrap
    process.env.HCM_BOOTSTRAP_EMPLOYEES = 'E1:L1,E2:L2';
    hcmAdapter.fetchBalance.mockImplementation(async (e: string, l: string) => ({ employeeId: e, locationId: l, balance: 10 }));

    await service.onModuleInit();

    expect(hcmAdapter.fetchBalance).toHaveBeenCalledWith('E1', 'L1');
    expect(hcmAdapter.fetchBalance).toHaveBeenCalledWith('E2', 'L2');
    expect(balanceSyncService.executeBatch).toHaveBeenCalledWith([
      { employeeId: 'E1', locationId: 'L1', balance: 10 },
      { employeeId: 'E2', locationId: 'L2', balance: 10 },
    ]);

    delete process.env.HCM_BOOTSTRAP_EMPLOYEES;
  });

  it('skips sync when no balances returned', async () => {
    hcmAdapter.fetchAllBalances.mockResolvedValue([]);
    process.env.HCM_BOOTSTRAP_EMPLOYEES = '';

    await service.onModuleInit();

    expect(balanceSyncService.executeBatch).not.toHaveBeenCalled();
    delete process.env.HCM_BOOTSTRAP_EMPLOYEES;
  });

  it('does not throw when adapter errors', async () => {
    hcmAdapter.fetchAllBalances.mockRejectedValue(new Error('network')); 
    await expect(service.onModuleInit()).resolves.not.toThrow();
    expect(balanceSyncService.executeBatch).not.toHaveBeenCalled();
  });
});
