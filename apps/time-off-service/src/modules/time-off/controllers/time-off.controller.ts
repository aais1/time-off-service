import { Controller, Post, Get, Body, Param, Headers, BadRequestException, Inject } from '@nestjs/common';
import { RequestTimeOffService } from '../services/request-time-off.service';
import { BalanceSyncService } from '../services/sync-balances.service';
import { REQUEST_REPOSITORY } from '../repositories/request.repository.interface';
import { BALANCE_REPOSITORY } from '../repositories/balance.repository.interface';

export class CreateRequestDto {
  employeeId!: string;
  locationId!: string;
  days!: number;
}

export class SyncBalancesDto {
  balances!: {
    employeeId: string;
    locationId: string;
    balance: number;
    reason?: string;
  }[];
  timestamp?: string;
}

@Controller('api/v1/time-off')
export class TimeOffController {
  constructor(
    private readonly requestTimeOffService: RequestTimeOffService,
    private readonly balanceSyncService: BalanceSyncService,
    @Inject(REQUEST_REPOSITORY) private readonly requestRepo: any,
    @Inject(BALANCE_REPOSITORY) private readonly balanceRepo: any,
  ) {}

  @Post('requests')
  async submitRequest(@Body() dto: CreateRequestDto, @Headers('Idempotency-Key') idempotencyKey: string) {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    
    // In a real app we'd use class-validator, but doing simple checks for now
    if (dto.days <= 0) {
      throw new BadRequestException({ error: 'INVALID_DAYS', message: 'Days must be positive' });
    }

    try {
      const request = await this.requestTimeOffService.execute({
        ...dto,
        idempotencyKey,
      });

      // The TRD specifies 201 or 202, since it could be PENDING/RETRYING we'd ideally inspect request.status
      // but returning a single standard object matches the TRD best.
      return {
        requestId: request.id,
        status: request.status,
      };
    } catch (e: any) {
      if (e.message === 'INSUFFICIENT_BALANCE') {
        throw new BadRequestException({ error: 'INSUFFICIENT_BALANCE' });
      }
      throw e;
    }
  }

  @Get('requests/:id')
  async getRequest(@Param('id') id: string) {
    const request = await this.requestRepo.findById(id);
    if (!request) {
      throw new BadRequestException('Request not found');
    }
    return {
      requestId: request.id,
      status: request.status,
      employeeId: request.employeeId,
      days: request.days,
      requestedAt: request.requestedAt,
      processedAt: request.processedAt,
    };
  }

  @Get('balances/:employeeId/:locationId')
  async getBalance(@Param('employeeId') employeeId: string, @Param('locationId') locationId: string) {
    const balance = await this.balanceRepo.getBalance(employeeId, locationId);
    if (!balance) {
      throw new BadRequestException('Balance not found');
    }
    return {
      employeeId: balance.employeeId,
      locationId: balance.locationId,
      balance: balance.amount,
      lastSyncedAt: balance.lastSyncedAt,
    };
  }

  @Get('health')
  async health() {
    return { ok: true };
  }

  @Post('sync')
  async syncBalances(@Body() dto: SyncBalancesDto) {
    await this.balanceSyncService.executeBatch(dto.balances);
    return {
      syncedCount: dto.balances.length,
      timestamp: new Date().toISOString(),
    };
  }
}
