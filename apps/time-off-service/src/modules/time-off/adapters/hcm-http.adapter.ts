import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { HcmAdapter, HcmTimeOffRequestParams, HcmTimeOffRequestResponse } from './hcm.adapter.interface';

@Injectable()
export class HcmHttpAdapter implements HcmAdapter {
  private readonly logger = new Logger(HcmHttpAdapter.name);

  constructor(private readonly httpService: HttpService) {}

  async submitTimeOffRequest(params: HcmTimeOffRequestParams): Promise<HcmTimeOffRequestResponse> {
    try {
  const base = process.env.HCM_URL || "http://localhost:4000" ;
      const url = `${base.replace(/\/$/, '')}/realtime/book`;
      const response = await lastValueFrom(
        this.httpService.post(url, params, { timeout: 5000 })
      );
      
      // Axios resolves promises on 2xx responses
      return {
        status: 'approved',
        hcmReferenceId: response.data.hcmReferenceId,
        remainingBalance: response.data.remainingBalance,
      };
    } catch (error: any) {
  if (error.response?.status === 400) {
         // Business rejection from HCM
         return {
           status: 'rejected',
           error: error.response.data.error || 'BAD_REQUEST',
           currentBalance: error.response.data.currentBalance,
           requested: error.response.data.requested,
         };
      }
      
      // Technical error (Timeout, 5xx, Network down)
      this.logger.error(`HCM Adapter failed: ${error.message}`);
      throw error;
    }
  }

  async fetchAllBalances(): Promise<Array<{ employeeId: string; locationId: string; balance: number }>> {
    try {
  const base = process.env.HCM_URL || "http://localhost:4000";
      const url = `${base.replace(/\/$/, '')}/balances`;
      const response = await lastValueFrom(this.httpService.get(url, { timeout: 5000 }));
      // Expect HCM mock to return an array of { employeeId, locationId, balance }
      return response.data || [];
    } catch (err: any) {
      this.logger.warn(`fetchAllBalances failed: ${err.message}`);
      return [];
    }
  }

  async fetchBalance(employeeId: string, locationId: string): Promise<{ employeeId: string; locationId: string; balance: number } | null> {
    try {
  const base = process.env.HCM_URL || "http://localhost:4000";
      const url = `${base.replace(/\/$/, '')}/balances/${encodeURIComponent(employeeId)}/${encodeURIComponent(locationId)}`;
      const response = await lastValueFrom(this.httpService.get(url, { timeout: 5000 }));
      return response.data || null;
    } catch (err: any) {
      this.logger.warn(`fetchBalance failed for ${employeeId}/${locationId}: ${err.message}`);
      return null;
    }
  }
}
