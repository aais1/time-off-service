import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { BalanceSyncService } from './sync-balances.service';
import { HCM_ADAPTER } from '../adapters/hcm.adapter.interface';
import type { HcmAdapter } from '../adapters/hcm.adapter.interface';
 

@Injectable()
export class StartupSyncService implements OnModuleInit {
  private readonly logger = new Logger(StartupSyncService.name);

  constructor(
    @Inject(HCM_ADAPTER) private readonly hcmAdapter: HcmAdapter,
    private readonly balanceSyncService: BalanceSyncService,
  ) {}

  async onModuleInit() {
    try {
      this.logger.log('Running startup sync with HCM (if available)');
      let balances: Array<{ employeeId: string; locationId: string; balance: number }> = await this.hcmAdapter.fetchAllBalances?.() || [];

      if (!balances || balances.length === 0) {
        this.logger.log('No batch balances returned by HCM; attempting per-employee bootstrap from HCM_BOOTSTRAP_EMPLOYEES');
        const bootstrap = process.env.HCM_BOOTSTRAP_EMPLOYEES || 'E123:US-CA';
        const pairs = bootstrap.split(',').map(s => s.trim()).filter(Boolean);
        const fetched: Array<{ employeeId: string; locationId: string; balance: number }> = [];
        for (const pair of pairs) {
          const [employeeId, locationId] = pair.split(':');
          if (!employeeId || !locationId) continue;
          const b = await this.hcmAdapter.fetchBalance?.(employeeId, locationId);
          if (b) fetched.push(b);
        }
        balances = fetched;
      }

      if (!balances || balances.length === 0) {
        this.logger.log('No balances available from HCM on startup; skipping sync');
        return;
      }

      // transform to the DTO expected by BalanceSyncService
      const payload = balances.map((b: { employeeId: string; locationId: string; balance: number }) => ({ employeeId: b.employeeId, locationId: b.locationId, balance: b.balance }));
      await this.balanceSyncService.executeBatch(payload);
      this.logger.log(`Startup sync completed: ${payload.length} balances upserted`);
    } catch (err: any) {
      this.logger.warn(`Startup sync failed or HCM unavailable: ${err.message}`);
      // Non-fatal: continue boot (we don't want to crash the app if HCM is temporarily down)
    }
  }
}
