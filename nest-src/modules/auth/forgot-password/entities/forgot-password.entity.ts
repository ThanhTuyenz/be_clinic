import {
  BeforeInsert,
  Column,
  Entity,
  Index,
  ObjectIdColumn,
  PrimaryColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Allow } from 'class-validator';
import { EntityHelper } from 'src/common/utils/entity-helper';
import { randomUUID } from 'crypto';
import { ObjectId } from 'mongodb';

@Entity()
export class ForgotPassword extends EntityHelper {
  @ObjectIdColumn()
  _id: ObjectId;

  @PrimaryColumn({ type: String })
  id: string;

  @Allow()
  @Column()
  @Index()
  hash: string;

  @Allow()
  @Column({ nullable: true })
  user?: User | string | null;

  @Allow()
  @Column({ type: String, nullable: true })
  userId?: string | null;

  @Column({ type: Date })
  createdAt: Date;

  @Column({ type: Date, nullable: true })
  deletedAt: Date | null;

  @BeforeInsert()
  setId() {
    if (!this.id) {
      this.id = randomUUID();
    }
    if (!this.createdAt) {
      this.createdAt = new Date();
    }
  }
}
