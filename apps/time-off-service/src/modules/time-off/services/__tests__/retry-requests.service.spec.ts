/// <reference types="jest" />
import { RetryRequestsService } from '../retry-requests.service';

describe('RetryRequestsService', () => {
  let service: RetryRequestsService;
  let requestRepo: any;
  let hcmAdapter: any;

  beforeEach(() => {
    requestRepo = {
      findByStatus: jest.fn(),
      save: jest.fn(),
    };

    hcmAdapter = {
      submitTimeOffRequest: jest.fn(),
    };

    // create service with mocks
    service = new RetryRequestsService(requestRepo, hcmAdapter);
  });

  it('skips retry if backoff window not passed', async () => {
    const now = Date.now();
    // Request with processedAt very recent and retryCount=1
    const req = { id: 'r1', retryCount: 1, processedAt: new Date(now).toISOString(), employeeId: 'e1', locationId: 'l1', days: 1, idempotencyKey: 'k' };
    requestRepo.findByStatus.mockResolvedValue([req]);

    await service.handleRetries();

    // Adapter should not be called because backoff prevents it
    expect(hcmAdapter.submitTimeOffRequest).not.toHaveBeenCalled();
  });

});
