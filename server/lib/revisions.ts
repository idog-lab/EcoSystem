import { ApiError, conflict } from '../http/errors'

// The one optimistic-concurrency primitive. Every shared record (folder,
// placement, document, assumption set) carries an integer `revision`. A write
// says which revision it was made from; it is applied only if that is still
// the stored revision, and the revision goes up by one. Otherwise nothing is
// written and the caller gets a 409 with the current record, so nobody's
// change is overwritten and the client keeps the user's unsaved edit.
//
// Run inside a transaction. Under PostgreSQL's READ COMMITTED, two writers at
// the same revision serialize on the row lock: the second re-checks the WHERE
// clause against the new row, matches nothing, and conflicts.

export type CompareAndSwap<Row, Out> = {
  expectedRevision: number
  /** An UPDATE ... WHERE revision = expectedRevision (e.g. Prisma updateMany). */
  update: () => Promise<{ count: number }>
  /** Reads the record as it is now (after a successful update, or to report a conflict). */
  load: () => Promise<Row | null>
  /** What the client is given: the record after the write, or the current one on a conflict. */
  present: (row: Row) => Out
  what: string
}

export async function writeAtRevision<Row, Out>({ expectedRevision, update, load, present, what }: CompareAndSwap<Row, Out>): Promise<Out> {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw new ApiError(400, 'validation', 'expectedRevision must be a positive whole number.')
  }
  const { count } = await update()
  const current = await load()
  if (!current) throw new ApiError(404, 'not_found', `${what} was not found.`)
  if (count === 0) throw conflict(`${what} was changed by someone else since revision ${expectedRevision}.`, present(current))
  return present(current)
}

/** The data part of an update that also moves the revision on. */
export const nextRevision = { revision: { increment: 1 } } as const
