export enum RequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  RETRYING = 'RETRYING',
  FAILED = 'FAILED',
}

export class TimeOffRequest {
  constructor(
    public readonly id: string,
    public readonly employeeId: string,
    public readonly locationId: string,
    public readonly days: number,
    public status: RequestStatus,
    public readonly idempotencyKey: string,
    public readonly requestedAt: Date,
    public hcmReferenceId?: string,
    public processedAt?: Date,
    public retryCount: number = 0,
    public lastError?: string,
    public metadata: Record<string, any> = {},
  ) {}

  approve(hcmReferenceId: string): void {
    if (this.status !== RequestStatus.PENDING && this.status !== RequestStatus.RETRYING) {
      throw new Error(`Cannot approve request in status ${this.status}`);
    }
    this.status = RequestStatus.APPROVED;
    this.hcmReferenceId = hcmReferenceId;
    this.processedAt = new Date();
  }

  reject(reason: string): void {
    if (this.status !== RequestStatus.PENDING && this.status !== RequestStatus.RETRYING) {
      throw new Error(`Cannot reject request in status ${this.status}`);
    }
    this.status = RequestStatus.REJECTED;
    this.lastError = reason;
    this.processedAt = new Date();
  }

  markRetrying(error: string): void {
    this.status = RequestStatus.RETRYING;
    this.lastError = error;
  }

  markFailed(error: string): void {
    this.status = RequestStatus.FAILED;
    this.lastError = error;
    this.processedAt = new Date();
  }

  incrementRetry(): void {
    this.retryCount += 1;
  }
}
