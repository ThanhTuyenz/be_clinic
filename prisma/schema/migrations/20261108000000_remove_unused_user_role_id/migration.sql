-- Roles and effective permissions use users.role and users.custom_permissions.
ALTER TABLE "users" DROP COLUMN "role_id";
