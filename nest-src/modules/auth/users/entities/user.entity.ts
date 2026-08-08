import {
  Column,
  AfterLoad,
  Entity,
  Index,
  ObjectIdColumn,
  PrimaryColumn,
  BeforeInsert,
  BeforeUpdate,
} from 'typeorm';
import { ObjectId } from 'mongodb';
import { randomUUID } from 'crypto';

import { EntityHelper } from 'src/common/utils/entity-helper';

import { Exclude } from 'class-transformer';
import { AuthProvidersEnum } from '../../auth-local/enums/auth-providers.enum';
import { hashPassword } from 'src/common/utils/helpers';

export enum UserStatus {
  Active = 'active',
  Inactive = 'inactive',
}

export enum UserRole {
  SuperAdmin = 'super_admin',
  Admin = 'admin',
  Staff = 'staff',
  User = 'user',
}

@Entity()
export class User extends EntityHelper {
  @ObjectIdColumn()
  _id: ObjectId;

  @PrimaryColumn({ type: String })
  id: string;

  @Index()
  @Column({ type: String, nullable: true })
  email: string | null;

  @Column({ nullable: true })
  @Exclude({ toPlainOnly: true })
  password: string;

  @Exclude({ toPlainOnly: true })
  public previousPassword: string;

  @AfterLoad()
  public loadPreviousPassword(): void {
    this.previousPassword = this.password;
  }

  @BeforeInsert()
  setId() {
    if (!this.id) {
      this.id = randomUUID();
    }
  }

  @BeforeInsert()
  @BeforeUpdate()
  async setPassword() {
    if (this.previousPassword !== this.password && this.password) {
      this.password = await hashPassword(this.password);
    }
  }

  @Column({ default: AuthProvidersEnum.email })
  provider: string;

  @Column({ default: UserStatus.Active })
  status: UserStatus;

  @Column({ default: UserRole.User })
  role: UserRole;

  @Index()
  @Column({ type: String, nullable: true })
  socialId: string | null;

  @Index()
  @Column({ type: String, nullable: true })
  fullName: string | null;

  @Column({ type: String, nullable: true })
  roleId: string | null;

  @Column({ type: 'json', nullable: true })
  customPermissions: Array<{
    resourceType: string;
    action: string;
    resourceTarget: string;
    effect: string;
  }> | null;

  @Column({ type: String, nullable: true })
  @Index()
  @Exclude({ toPlainOnly: true })
  hash: string | null;

  @Column({ default: false })
  @Index()
  isBlocked: boolean;

  @Column({ type: Date, nullable: true, default: null })
  blockedAt: Date | null;

  @Column({ default: false })
  @Index()
  isDeleted: boolean;

  @Column({ type: Date, nullable: true, default: null })
  @Index()
  lastLoginAt: Date | null;

  @Column({ type: Date })
  createdAt: Date;

  @Column({ type: Date })
  updatedAt: Date;

  @BeforeInsert()
  setCreatedAt() {
    if (!this.createdAt) {
      this.createdAt = new Date();
    }
  }

  @BeforeUpdate()
  setUpdatedAt() {
    this.updatedAt = new Date();
  }
}
