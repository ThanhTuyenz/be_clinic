import { Injectable } from '@nestjs/common';
import { IForgotPasswordService } from './forgot-password';
import { FindOptions } from 'src/common/utils/types/find-options.type';
import { ForgotPassword } from './entities/forgot-password.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';

@Injectable()
export class ForgotPasswordService implements IForgotPasswordService {
  constructor(
    @InjectRepository(ForgotPassword)
    private readonly forgotPasswordRepository: Repository<ForgotPassword>,
  ) {}

  async create(data: DeepPartial<ForgotPassword>): Promise<ForgotPassword> {
    const forgotPasswordReq = this.forgotPasswordRepository.create(data);
    return this.forgotPasswordRepository.save(forgotPasswordReq);
  }

  async findOne(
    options: FindOptions<ForgotPassword>,
  ): Promise<ForgotPassword | null> {
    return this.forgotPasswordRepository.findOne({
      where: {
        ...options.where,
      },
    });
  }

  async softDelete(id: ForgotPassword['id']): Promise<void> {
    await this.forgotPasswordRepository.update(
      {
        id,
      },
      {
        deletedAt: new Date(),
      },
    );
  }
}
