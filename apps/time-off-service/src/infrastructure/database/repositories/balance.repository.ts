import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { BalanceRepository } from '../../../modules/time-off/repositories/balance.repository.interface';
import { TimeOffBalance } from '../../../modules/time-off/domain/entities/balance.entity';
import { BalanceOrmEntity } from '../entities/balance.orm-entity';

@Injectable()
export class TypeOrmBalanceRepository implements BalanceRepository {
  constructor(
    @InjectRepository(BalanceOrmEntity)
    private readonly ormRepo: Repository<BalanceOrmEntity>,
  ) {}

  private getRepo(manager?: EntityManager): Repository<BalanceOrmEntity> {
    return manager ? manager.getRepository(BalanceOrmEntity) : this.ormRepo;
  }

  async getBalance(employeeId: string, locationId: string, manager?: any): Promise<TimeOffBalance | null> {
    const repo = this.getRepo(manager);
    const ormEntity = await repo.findOne({ where: { employeeId, locationId } });
    if (!ormEntity) return null;
    return this.toDomain(ormEntity);
  }

  async updateBalance(balance: TimeOffBalance, manager?: any): Promise<void> {
    const repo = this.getRepo(manager);
    const ormEntity = this.toOrm(balance);
    const result = await repo.update(
      { employeeId: balance.employeeId, locationId: balance.locationId, version: balance.version },
      { ...ormEntity, version: balance.version + 1 },
    );
    if (result.affected === 0) {
      throw new Error('Concurrent modification detected or balance not found');
    }
  }

  async upsertBalances(balances: TimeOffBalance[]): Promise<void> {
    const ormEntities = balances.map(b => this.toOrm(b));
    // Simple save acts as upsert, but for optimistic locking bypass we might need custom logic.
    // For sync we assume we overwrite and increment version.
    for (const entity of ormEntities) {
       const existing = await this.ormRepo.findOne({ where: { employeeId: entity.employeeId, locationId: entity.locationId }});
       if (existing) {
         await this.ormRepo.update({ employeeId: entity.employeeId, locationId: entity.locationId }, { ...entity, version: existing.version + 1 });
       } else {
         await this.ormRepo.save({ ...entity, version: 1 });
       }
    }
  }

  private toDomain(ormEntity: BalanceOrmEntity): TimeOffBalance {
    return new TimeOffBalance(
      ormEntity.employeeId,
      ormEntity.locationId,
      ormEntity.amount,
      ormEntity.version,
      ormEntity.lastSyncedAt,
      ormEntity.updatedAt,
    );
  }

  private toOrm(domain: TimeOffBalance): BalanceOrmEntity {
    const orm = new BalanceOrmEntity();
    orm.employeeId = domain.employeeId;
    orm.locationId = domain.locationId;
    orm.amount = domain.amount;
    orm.version = domain.version;
    orm.lastSyncedAt = domain.lastSyncedAt;
    orm.updatedAt = domain.updatedAt;
    return orm;
  }
}
