import type { RolePermissionDto } from './dtos/create-role.dto.js'

export interface IRolesService {
  findOne(roleId: string): Promise<{
    id: string
    name?: string
    permissions?: RolePermissionDto[]
  } | null>
}
