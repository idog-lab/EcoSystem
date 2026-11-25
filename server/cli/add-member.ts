import { parseArgs } from 'node:util'
import { createPrisma } from '../db/prisma'

// Adds people to a workspace (creating the workspace the first time):
//   npm run db:add-member -- --workspace superplay --name "SuperPlay" --email a@x.com --email b@x.com
// A person who signs in but is not a member sees no workspace data.

const { values } = parseArgs({
  options: {
    workspace: { type: 'string' },
    name: { type: 'string' },
    email: { type: 'string', multiple: true },
  },
})

const slug = values.workspace?.trim().toLowerCase()
const emails = (values.email ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean)
if (!slug || !/^[a-z0-9-]+$/.test(slug) || emails.length === 0) {
  console.error('Usage: npm run db:add-member -- --workspace <slug> [--name "Display name"] --email <email> [--email <email> ...]')
  process.exit(1)
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}

const db = createPrisma(process.env.DATABASE_URL)
const workspace = await db.workspace.upsert({ where: { slug }, update: {}, create: { slug, name: values.name ?? slug } })
for (const email of emails) {
  const user = await db.user.upsert({ where: { email }, update: {}, create: { email, name: email.split('@')[0] ?? email } })
  await db.membership.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
    update: {},
    create: { workspaceId: workspace.id, userId: user.id },
  })
  console.log(`${email} is a member of "${workspace.name}" (${workspace.slug}).`)
}
await db.$disconnect()
