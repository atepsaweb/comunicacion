import { NextRequest } from 'next/server';

export function validateInternalSecret(req: NextRequest): boolean {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization');
  if (!auth) return false;
  const spaceIdx = auth.indexOf(' ');
  if (spaceIdx === -1) return false;
  const scheme = auth.slice(0, spaceIdx);
  const token = auth.slice(spaceIdx + 1);
  return scheme === 'Bearer' && token === secret;
}
