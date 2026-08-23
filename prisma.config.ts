import path from 'node:path'
import dotenv from 'dotenv'
import { defineConfig } from 'prisma/config'

dotenv.config({ path: path.resolve(process.cwd(), '.env.development') })
// dotenv.config({ path: path.resolve(process.cwd(), '.env') })

export default defineConfig({
  schema: path.join('prisma', 'schema'),
  migrations: {
    path: path.join('prisma', 'schema', 'migrations'),
    seed: 'node prisma/seed.mjs',
  },
})

