import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { REQUEST_REPOSITORY } from '../repositories/request.repository.interface';
import { RequestStatus } from '../domain/entities/request.entity';
import { HCM_ADAPTER } from '../adapters/hcm.adapter.interface';

const MAX_RETRIES = 5;

@Injectable()
export class RetryRequestsService {
  private readonly logger = new Logger(RetryRequestsService.name);

  constructor(
    @Inject(REQUEST_REPOSITORY) private readonly requestRepo: any,
    @Inject(HCM_ADAPTER) private readonly hcmAdapter: any,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async handleRetries() {
    this.logger.debug('Running background retry job...');
    const retryingRequests = await this.requestRepo.findByStatus(RequestStatus.RETRYING);

    for (const req of retryingRequests) {
      if (req.retryCount >= MAX_RETRIES) {
        req.markFailed(`Max retries (${MAX_RETRIES}) reached. Last error: ${req.lastError}`);
        await this.requestRepo.save(req);
        this.logger.error(`Request ${req.id} FAILED after ${MAX_RETRIES} retries.`);
        continue;
      }

      // Exponential backoff: compute minimum delay before next retry
      const baseMs = Number(process.env.RETRY_BASE_MS ?? 5000); // default 5s
      const maxBackoffMs = Number(process.env.RETRY_MAX_MS ?? 5 * 60 * 1000); // default 5min
      const backoffMs = Math.min(maxBackoffMs, baseMs * Math.pow(2, req.retryCount));
      const lastAttemptMs = req.processedAt ? new Date(req.processedAt).getTime() : 0;
      const now = Date.now();
      if (lastAttemptMs && now - lastAttemptMs < backoffMs) {
        this.logger.debug(`Skipping request ${req.id} retry ${req.retryCount} until backoff window passes.`);
        continue;
      }

      req.incrementRetry();
      try {
        const hcmResult = await this.hcmAdapter.submitTimeOffRequest({
          employeeId: req.employeeId,
          locationId: req.locationId,
          days: req.days,
          idempotencyKey: req.idempotencyKey,
        });

        if (hcmResult.status === 'approved') {
          req.approve(hcmResult.hcmReferenceId);
          this.logger.log(`Request ${req.id} APPROVED on retry ${req.retryCount}`);
        } else {
          req.reject(hcmResult.error);
          this.logger.warn(`Request ${req.id} REJECTED on retry ${req.retryCount}`);
        }
      } catch (error: any) {
        req.markRetrying(error.message);
        this.logger.debug(`Request ${req.id} failed again on retry ${req.retryCount}. Will retry later.`);
      }

      await this.requestRepo.save(req);
    }
  }
}
