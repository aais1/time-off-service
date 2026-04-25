import { TimeOffRequest, RequestStatus } from '../domain/entities/request.entity';

export const REQUEST_REPOSITORY = 'REQUEST_REPOSITORY';

export interface RequestRepository {
  /**
   * Retrieves a request by its ID.
   */
  findById(id: string, transactionalEntityManager?: any): Promise<TimeOffRequest | null>;

  /**
   * Finds a request by its unique idempotency key.
   */
  findByIdempotencyKey(key: string, transactionalEntityManager?: any): Promise<TimeOffRequest | null>;

  /**
   * Saves a request (insert or update). Can run inside a provided transaction manager.
   */
  save(request: TimeOffRequest, transactionalEntityManager?: any): Promise<void>;

  /**
   * Finds all requests with a specific status, potentially for retry or reconciliation.
   */
  findByStatus(status: RequestStatus): Promise<TimeOffRequest[]>;
  
  /**
   * Finds all PENDING or RETRYING requests for a given employee and location.
   */
  findPendingAndRetrying(employeeId: string, locationId: string): Promise<TimeOffRequest[]>;
}
