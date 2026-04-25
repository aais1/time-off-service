import { TimeOffBalance } from '../domain/entities/balance.entity';

export const BALANCE_REPOSITORY = 'BALANCE_REPOSITORY';

export interface EntityManager {
  /**
   * Simple abstraction since Hexagonal shouldn't know about TypeORM QueryRunners
   */
}

export interface BalanceRepository {
  /**
   * Retrieves a balance. Can run inside a provided transaction/entity manager.
   */
  getBalance(employeeId: string, locationId: string, transactionalEntityManager?: any): Promise<TimeOffBalance | null>;

  /**
   * Updates balance using optimistic locking (version increment) inside a transaction.
   * Throws an error or returns false if concurrent modification detected.
   */
  updateBalance(balance: TimeOffBalance, transactionalEntityManager?: any): Promise<void>;

  /**
   * Batch upsert from sync, outside the normal request flow.
   */
  upsertBalances(balances: TimeOffBalance[]): Promise<void>;
}
