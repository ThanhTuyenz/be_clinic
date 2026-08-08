import { Injectable } from '@nestjs/common'
import type { IRolesService } from './roles.js'

@Injectable()
export class RolesService implements IRolesService {
  async findOne(roleId: string) {
    return { id: roleId, name: 'user' }
  }
}