import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BalanceOrmEntity } from './entities/balance.orm-entity';
import { RequestOrmEntity } from './entities/request.orm-entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: 'time_off_prod.db',
      entities: [BalanceOrmEntity, RequestOrmEntity],
      synchronize: true, // For assessment only; in prod we'd use migrations
      logging: false, // Turn off query logging to reduce noise
    }),
  ],
})
export class DatabaseModule {}
