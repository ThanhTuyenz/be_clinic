import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';
import { Session } from './entities/session.entity';
import { User } from '../users/entities/user.entity';
import { FindOptions } from 'src/common/utils/types/find-options.type';
import { NullableType } from 'src/common/utils/types/nullable.type';
import { ISessionService } from './session';

@Injectable()
export class SessionService implements ISessionService {
  constructor(
    @InjectRepository(Session)
    private readonly sessionRepository: Repository<Session>,
  ) {}
  async findOne(options: FindOptions<Session>): Promise<NullableType<Session>> {
    const session = await this.sessionRepository.findOne({
      where: options.where,
    });

    if (!session || session.deletedAt) {
      return null;
    }

    return session;
  }

  async findMany(options: FindOptions<Session>): Promise<Session[]> {
    const sessions = await this.sessionRepository.find({
      where: options.where,
    });

    return sessions.filter((session) => !session.deletedAt);
  }

  async create(data: DeepPartial<Session>): Promise<Session> {
    const session = this.sessionRepository.create(data);
    return this.sessionRepository.save(session);
  }

  async softDelete({
    excludeId,
    ...criteria
  }: {
    id?: Session['id'];
    user?: Pick<User, 'id'>;
    excludeId?: Session['id'];
  }): Promise<void> {
    const sessions = await this.sessionRepository.find({
      where: criteria,
    });

    const sessionsToDelete = sessions.filter((session) => {
      if (session.deletedAt) {
        return false;
      }

      if (excludeId && session.id === excludeId) {
        return false;
      }

      return true;
    });

    if (!sessionsToDelete.length) {
      return;
    }

    const deletedAt = new Date();
    await this.sessionRepository.save(
      sessionsToDelete.map((session) => ({
        ...session,
        deletedAt,
      })),
    );
  }
}
