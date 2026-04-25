export const HCM_ADAPTER = 'HCM_ADAPTER';

export interface HcmTimeOffRequestParams {
  employeeId: string;
  locationId: string;
  days: number;
  idempotencyKey: string;
}

export interface HcmTimeOffRequestSuccess {
  status: 'approved';
  hcmReferenceId: string;
  remainingBalance: number;
}

export interface HcmTimeOffRequestFailure {
  status: 'rejected';
  error: string;
  currentBalance?: number;
  requested?: number;
}

export type HcmTimeOffRequestResponse = HcmTimeOffRequestSuccess | HcmTimeOffRequestFailure;

export interface HcmAdapter {
  /**
   * Submits a time-off request to the HCM system.
   * Throws an error on 5xx or network timeout.
   * Resolves with 'approved' or 'rejected' on business responses.
   */
  submitTimeOffRequest(params: HcmTimeOffRequestParams): Promise<HcmTimeOffRequestResponse>;
}
