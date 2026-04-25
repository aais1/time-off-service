import { Injectable, Inject, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BalanceOrmEntity } from '../../../infrastructure/database/entities/balance.orm-entity';
import { BALANCE_REPOSITORY } from '../repositories/balance.repository.interface';
import { REQUEST_REPOSITORY } from '../repositories/request.repository.interface';
import { TimeOffBalance } from '../domain/entities/balance.entity';
import { RequestStatus } from '../domain/entities/request.entity';

export interface SyncBalanceDto {
  employeeId: string;
  locationId: string;
  balance: number;
}

@Injectable()
export class BalanceSyncService {
  private readonly logger = new Logger(BalanceSyncService.name);

  constructor(
    @Inject(BALANCE_REPOSITORY) private readonly balanceRepo: any,
    @Inject(REQUEST_REPOSITORY) private readonly requestRepo: any,
    private readonly dataSource: DataSource,
  ) {}

  async executeBatch(balances: SyncBalanceDto[]): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      this.logger.log(`Starting batch sync for ${balances.length} balances`);

      // 1. Bulk Upsert Balances
      for (const b of balances) {
        // Simple abstraction for upsert via existing repo interface for this assessment
        const existing = await this.balanceRepo.getBalance(b.employeeId, b.locationId, queryRunner.manager);
        if (existing) {
          existing.sync(b.balance);
          await this.balanceRepo.updateBalance(existing, queryRunner.manager);
        } else {
          const newBalance = new TimeOffBalance(
            b.employeeId,
            b.locationId,
            b.balance,
            1,
            new Date(),
            new Date()
          );
          // Persist via ORM entity inside the current transaction to ensure the row is created
          const ormRepo = queryRunner.manager.getRepository(BalanceOrmEntity);
          const ormEntity = new BalanceOrmEntity();
          ormEntity.employeeId = newBalance.employeeId;
          ormEntity.locationId = newBalance.locationId;
          ormEntity.amount = newBalance.amount;
          ormEntity.version = 1;
          ormEntity.lastSyncedAt = newBalance.lastSyncedAt;
          // updatedAt is handled by the UpdateDateColumn on save
          await ormRepo.save(ormEntity);
        }

        // 2. Perform Reconciliation for each synced balance
        await this.reconcileRequests(b.employeeId, b.locationId, b.balance, queryRunner.manager);
      }

      await queryRunner.commitTransaction();
      this.logger.log('Batch sync completed successfully');
      
    } catch (error: any) {
      this.logger.error(`Batch sync failed: ${error.message}`);
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async reconcileRequests(employeeId: string, locationId: string, currentBalanceAmount: number, manager: any): Promise<void> {
    // Find all requests in PENDING or RETRYING states
    const pendingAndRetrying = await this.requestRepo.findPendingAndRetrying(employeeId, locationId);

    // Sum up the requested days
    // Wait, the local balance cache SHOULD already have these requests deducted if they just happened.
    // However, if the HCM sync gave us a lower absolute balance, we need to ensure that the pending requests
    // don't exceed the newly synced balance.
    // Actually, HCM balance might be the TRUE remaining balance *excluding* pending requests, or *including* them.
    // If it *includes* them (HCM knows about them), then it's fine. 
    // If HCM balance is 5, but we have 8 in PENDING, and HCM doesn't know about the 8 yet, 
    // it means there's 5 left in reality. Approving the 8 will fail in HCM.
    // So if sum(pending_days) > true_balance_amount, we must reject the oldest or largest? 
    // Simpler: iterate through PENDING, if total > balance, reject them.

    let available = currentBalanceAmount;

    for (const req of pendingAndRetrying) {
      if (req.days > available) {
        this.logger.warn(`Reconciliation: Rejecting request ${req.id} due to insufficient balance after sync.`);
        req.reject('insufficient balance after sync');
        await this.requestRepo.save(req, manager);
      } else {
        available -= req.days;
      }
    }
  }
}
