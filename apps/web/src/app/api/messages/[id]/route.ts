// Endpoint para que un secretario elimine un mensaje propio que ya envió por
// WhatsApp (ej: mandó algo erróneo y no quiere que cuente para el reporte).
// El borrado es lógico: marca discarded_at y discard_reason='deleted_by_user'.
// El admin (press_admin) puede eliminar mensajes de cualquier usuario.
//
// Si el mensaje ya generó report_items (source_message_id = id), esos ítems
// se eliminan automáticamente para que no contaminen el consolidado.
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { logger } from '@/lib/logger';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const msg = await db.query.inboundMessages.findFirst({
    where: eq(schema.inboundMessages.id, params.id),
    columns: { id: true, user_id: true, discarded_at: true },
  });

  if (!msg) return NextResponse.json({ error: 'Mensaje no encontrado' }, { status: 404 });

  const isOwner = msg.user_id === session.user.id;
  const isAdmin = session.user.role === 'press_admin';
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (msg.discarded_at) {
    return NextResponse.json({ ok: true, alreadyDiscarded: true });
  }

  await db
    .update(schema.inboundMessages)
    .set({
      discarded_at: new Date(),
      discard_reason: isAdmin && !isOwner ? 'deleted_by_admin' : 'deleted_by_user',
    })
    .where(eq(schema.inboundMessages.id, params.id));

  // Eliminar los ítems que este mensaje generó (si ya fue procesado por la IA).
  // Evita que contenido descartado aparezca en el consolidado.
  const deleted = await db
    .delete(schema.reportItems)
    .where(eq(schema.reportItems.source_message_id, params.id))
    .returning({ id: schema.reportItems.id });

  logger.info(
    {
      messageId: params.id,
      deletedBy: session.user.id,
      asAdmin: isAdmin && !isOwner,
      itemsRemoved: deleted.length,
    },
    'inbound message discarded, report items cleaned',
  );

  return NextResponse.json({ ok: true, itemsRemoved: deleted.length });
}
