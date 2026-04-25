import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimeOffController } from './controllers/time-off.controller';
import { RequestTimeOffService } from './services/request-time-off.service';
import { BalanceSyncService } from './services/sync-balances.service';
import { RetryRequestsService } from './services/retry-requests.service';
import { TypeOrmBalanceRepository } from '../../infrastructure/database/repositories/balance.repository';
import { TypeOrmRequestRepository } from '../../infrastructure/database/repositories/request.repository';
import { BalanceOrmEntity } from '../../infrastructure/database/entities/balance.orm-entity';
import { RequestOrmEntity } from '../../infrastructure/database/entities/request.orm-entity';
import { HttpModule } from '@nestjs/axios';
import { HcmHttpAdapter } from './adapters/hcm-http.adapter';
import { StartupSyncService } from './services/startup-sync.service';
import { BALANCE_REPOSITORY } from './repositories/balance.repository.interface';
import { REQUEST_REPOSITORY } from './repositories/request.repository.interface';
import { HCM_ADAPTER } from './adapters/hcm.adapter.interface';

@Module({
  imports: [
    TypeOrmModule.forFeature([BalanceOrmEntity, RequestOrmEntity]),
    HttpModule
  ],
  controllers: [TimeOffController],
  providers: [
    RequestTimeOffService,
    BalanceSyncService,
    RetryRequestsService,
  StartupSyncService,
    {
      provide: BALANCE_REPOSITORY,
      useClass: TypeOrmBalanceRepository,
    },
    {
      provide: REQUEST_REPOSITORY,
      useClass: TypeOrmRequestRepository,
    },
    {
      provide: HCM_ADAPTER,
      useClass: HcmHttpAdapter,
    }
  ],
})
export class TimeOffModule {}
