import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';
import { RequestStatus } from '../../../modules/time-off/domain/entities/request.entity';

@Entity('time_off_requests')
export class RequestOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  employeeId!: string;

  @Column()
  locationId!: string;

  @Column('int')
  days!: number;

  @Column({ type: 'varchar', default: RequestStatus.PENDING })
  status!: RequestStatus;

  @Column({ unique: true })
  idempotencyKey!: string;

  @Column({ nullable: true })
  hcmReferenceId?: string;

  @CreateDateColumn()
  requestedAt!: Date;

  @Column({ type: 'datetime', nullable: true })
  processedAt?: Date;

  @Column('int', { default: 0 })
  retryCount!: number;

  @Column({ type: 'text', nullable: true })
  lastError?: string;

  @Column({ type: 'simple-json', nullable: true })
  metadata?: Record<string, any>;
}
