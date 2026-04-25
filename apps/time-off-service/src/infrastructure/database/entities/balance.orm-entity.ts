import { Entity, Column, PrimaryColumn, UpdateDateColumn, VersionColumn } from 'typeorm';

@Entity('time_off_balances')
export class BalanceOrmEntity {
  @PrimaryColumn()
  employeeId: string;

  @PrimaryColumn()
  locationId: string;

  @Column('int')
  amount: number;

  @VersionColumn()
  version: number;

  @Column('datetime', { nullable: true })
  lastSyncedAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
