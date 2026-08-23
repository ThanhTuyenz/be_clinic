import path from 'node:path'
import dotenv from 'dotenv'
import { defineConfig } from 'prisma/config'

dotenv.config({ path: path.resolve(process.cwd(), '.env') })
dotenv.config({ path: path.resolve(process.cwd(), '.env.development'), override: true })

export default defineConfig({
  schema: path.join('prisma', 'schema'),
  datasource: {
    url: process.env.DATABASE_URL || '',
    directUrl: process.env.DIRECT_URL || '',
  },
  migrations: {
    path: path.join('prisma', 'schema', 'migrations'),
    seed: 'node prisma/seed.mjs',
  },
})

