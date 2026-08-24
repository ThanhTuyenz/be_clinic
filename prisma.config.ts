import path from 'node:path'
import dotenv from 'dotenv'
import { defineConfig } from 'prisma/config'

const envFile = process.env.ENV_FILE || '.env.development'
dotenv.config({ path: path.resolve(process.cwd(), '.env') })
dotenv.config({ path: path.resolve(process.cwd(), envFile), override: true })

export default defineConfig({
  schema: path.join('prisma', 'schema'),
  datasource: {
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || '',
  },
  migrations: {
    path: path.join('prisma', 'schema', 'migrations'),
    seed: 'node prisma/seed.mjs',
  },
})

