// A video may be addressed by our primary key (cuid) or by the externalId the
// ingesting service supplied. Kept free of prisma imports so it is unit-testable.
export function videoWhere(idOrExternalId: string) {
  return { OR: [{ id: idOrExternalId }, { externalId: idOrExternalId }] }
}
