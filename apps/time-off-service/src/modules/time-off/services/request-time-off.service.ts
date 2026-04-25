import { Injectable, Inject, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { HcmAdapter, HCM_ADAPTER } from '../adapters/hcm.adapter.interface';
import { BalanceRepository, BALANCE_REPOSITORY } from '../repositories/balance.repository.interface';
import { RequestRepository, REQUEST_REPOSITORY } from '../repositories/request.repository.interface';
import { TimeOffRequest, RequestStatus } from '../domain/entities/request.entity';

export interface RequestTimeOffDto {
  employeeId: string;
  locationId: string;
  days: number;
  idempotencyKey: string;
}

@Injectable()
export class RequestTimeOffService {
  private readonly logger = new Logger(RequestTimeOffService.name);

  constructor(
    @Inject(BALANCE_REPOSITORY) private readonly balanceRepo: any,
    @Inject(REQUEST_REPOSITORY) private readonly requestRepo: any,
    @Inject(HCM_ADAPTER) private readonly hcmAdapter: any,
    private readonly dataSource: DataSource,
  ) {}

  async execute(dto: RequestTimeOffDto): Promise<TimeOffRequest> {
    // 1. Check idempotency key to avoid duplicate processing
    const existingRequest = await this.requestRepo.findByIdempotencyKey(dto.idempotencyKey);
    if (existingRequest) {
      this.logger.log(`Idempotency hit for key ${dto.idempotencyKey}`);
      return existingRequest;
    }

    const requestId = uuidv4();

    // 2. Perform local transaction: Verify balance, deduct, and write PENDING
    const timeOffRequest = await this.createPendingRequest(requestId, dto);

    // 3. Make HCM Call outside of the transaction
    try {
      this.logger.debug(`Calling HCM for request ${requestId}`);
      const hcmResult = await this.hcmAdapter.submitTimeOffRequest({
        employeeId: dto.employeeId,
        locationId: dto.locationId,
        days: dto.days,
        idempotencyKey: dto.idempotencyKey,
      });

      if (hcmResult.status === 'approved') {
        timeOffRequest.approve(hcmResult.hcmReferenceId);
        this.logger.log(`Request ${requestId} APPROVED by HCM`);
      } else {
        // Business rejection (e.g., HCM says insufficient balance)
        timeOffRequest.reject(hcmResult.error);
        this.logger.warn(`Request ${requestId} REJECTED by HCM: ${hcmResult.error}`);
        // Note: we might want to reconcile local balance here if it mismatched
      }

      await this.requestRepo.save(timeOffRequest);

    } catch (error: any) {
      // Technical failure: Network timeout, 5xx, etc.
      this.logger.error(`Technical failure calling HCM for request ${requestId}: ${error.message}`);
      timeOffRequest.markRetrying(error.message || 'Network timeout or 5xx');
      await this.requestRepo.save(timeOffRequest);
    }

    return timeOffRequest;
  }

  private async createPendingRequest(requestId: string, dto: RequestTimeOffDto): Promise<TimeOffRequest> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // We read balance with optimistic locking implicitly handled by version increment on update.
      // If we are extremely paranoid about reading dirty data, we could use a pessimistic read lock here, 
      // but optimistic update will catch it anyway.
      const balance = await this.balanceRepo.getBalance(dto.employeeId, dto.locationId, queryRunner.manager);
      
      if (!balance) {
        throw new Error('Balance not found for employee');
      }

      // Check balance
      if (balance.amount < dto.days) {
        throw new Error('INSUFFICIENT_BALANCE');
      }

      // Deduct balance locally
      balance.deduct(dto.days);
      await this.balanceRepo.updateBalance(balance, queryRunner.manager);

      // Create Request
      const request = new TimeOffRequest(
        requestId,
        dto.employeeId,
        dto.locationId,
        dto.days,
        RequestStatus.PENDING,
        dto.idempotencyKey,
        new Date()
      );

      await this.requestRepo.save(request, queryRunner.manager);

      await queryRunner.commitTransaction();
      return request;
      
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
