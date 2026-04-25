import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, In } from 'typeorm';
import { RequestRepository } from '../../../modules/time-off/repositories/request.repository.interface';
import { TimeOffRequest, RequestStatus } from '../../../modules/time-off/domain/entities/request.entity';
import { RequestOrmEntity } from '../entities/request.orm-entity';

@Injectable()
export class TypeOrmRequestRepository implements RequestRepository {
  constructor(
    @InjectRepository(RequestOrmEntity)
    private readonly ormRepo: Repository<RequestOrmEntity>,
  ) {}

  private getRepo(manager?: EntityManager): Repository<RequestOrmEntity> {
    return manager ? manager.getRepository(RequestOrmEntity) : this.ormRepo;
  }

  async findById(id: string, manager?: any): Promise<TimeOffRequest | null> {
    const ormEntity = await this.getRepo(manager).findOne({ where: { id } });
    if (!ormEntity) return null;
    return this.toDomain(ormEntity);
  }

  async findByIdempotencyKey(key: string, manager?: any): Promise<TimeOffRequest | null> {
    const ormEntity = await this.getRepo(manager).findOne({ where: { idempotencyKey: key } });
    if (!ormEntity) return null;
    return this.toDomain(ormEntity);
  }

  async save(request: TimeOffRequest, manager?: any): Promise<void> {
    const repo = this.getRepo(manager);
    const ormEntity = this.toOrm(request);
    await repo.save(ormEntity);
  }

  async findByStatus(status: RequestStatus): Promise<TimeOffRequest[]> {
    const ormEntities = await this.ormRepo.find({ where: { status } });
    return ormEntities.map(e => this.toDomain(e));
  }

  async findPendingAndRetrying(employeeId: string, locationId: string): Promise<TimeOffRequest[]> {
    const ormEntities = await this.ormRepo.find({
      where: {
        employeeId,
        locationId,
        status: In([RequestStatus.PENDING, RequestStatus.RETRYING]),
      },
    });
    return ormEntities.map(e => this.toDomain(e));
  }

  private toDomain(ormEntity: RequestOrmEntity): TimeOffRequest {
    return new TimeOffRequest(
      ormEntity.id,
      ormEntity.employeeId,
      ormEntity.locationId,
      ormEntity.days,
      ormEntity.status,
      ormEntity.idempotencyKey,
      ormEntity.requestedAt,
      ormEntity.hcmReferenceId,
      ormEntity.processedAt,
      ormEntity.retryCount,
      ormEntity.lastError,
      ormEntity.metadata,
    );
  }

  private toOrm(domain: TimeOffRequest): RequestOrmEntity {
    const orm = new RequestOrmEntity();
    orm.id = domain.id;
    orm.employeeId = domain.employeeId;
    orm.locationId = domain.locationId;
    orm.days = domain.days;
    orm.status = domain.status;
    orm.idempotencyKey = domain.idempotencyKey;
    orm.requestedAt = domain.requestedAt;
    orm.hcmReferenceId = domain.hcmReferenceId;
    orm.processedAt = domain.processedAt;
    orm.retryCount = domain.retryCount;
    orm.lastError = domain.lastError;
    orm.metadata = domain.metadata;
    return orm;
  }
}
