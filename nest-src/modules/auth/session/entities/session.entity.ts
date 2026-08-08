import {
  BeforeInsert,
  Column,
  Entity,
  ManyToOne,
  ObjectIdColumn,
  PrimaryColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { EntityHelper } from 'src/common/utils/entity-helper';
import { randomUUID } from 'crypto';
import { ObjectId } from 'mongodb';

@Entity()
export class Session extends EntityHelper {
  @ObjectIdColumn()
  _id: ObjectId;

  @PrimaryColumn({ type: String })
  id: string;

  @ManyToOne(() => User, {
    eager: true,
  })
  user: User;

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
