'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Upload, Search, Trash2, Pencil, Plus } from 'lucide-react';

export type AffiliateRow = {
  id: string;
  last_name: string;
  first_name: string;
  aeropuerto: string | null;
  organismo: string | null;
  rama: string | null;
  tipo: string | null;
  vigencia: string | null;
  dependency: string | null;
  position: string | null;
  dni: string | null;
  legajo: string | null;
  email: string | null;
  phone_e164: string | null;
  notes: string | null;
  is_active: boolean;
};

interface Props {
  initialAffiliates: AffiliateRow[];
}

type FormState = Omit<AffiliateRow, 'id'>;
const EMPTY: FormState = {
  last_name: '', first_name: '',
  aeropuerto: '', organismo: '', rama: '', tipo: '', vigencia: '',
  dependency: '', position: '',
  dni: '', legajo: '', email: '', phone_e164: '', notes: '',
  is_active: true,
};

const TIPO_OPTIONS = ['Base', 'Congresal', 'Ambos'];
const ORGANISMO_OPTIONS = ['EANA', 'ANAC', 'Otro'];

const TIPO_COLOR: Record<string, string> = {
  Base:      'bg-blue-50 text-blue-700',
  Congresal: 'bg-green-50 text-green-700',
  Ambos:     'bg-yellow-50 text-yellow-700',
};

export function AfiliadosClient({ initialAffiliates }: Props) {
  const router = useRouter();
  const [affiliates, setAffiliates] = useState(initialAffiliates);
  const [search, setSearch] = useState('');
  const [editModal, setEditModal] = useState<'create' | 'edit' | null>(null);
  const [editing, setEditing] = useState<AffiliateRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState('');

  // Import modal
  const [importOpen, setImportOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return affiliates;
    return affiliates.filter(a =>
      `${a.last_name} ${a.first_name} ${a.aeropuerto ?? ''} ${a.organismo ?? ''} ${a.rama ?? ''} ${a.tipo ?? ''}`
        .toLowerCase().includes(q),
    );
  }, [affiliates, search]);

  function openCreate() { setForm(EMPTY); setEditing(null); setError(''); setEditModal('create'); }
  function openEdit(a: AffiliateRow) { setEditing(a); setForm({ ...EMPTY, ...a }); setError(''); setEditModal('edit'); }
  function closeEdit() { setEditModal(null); setEditing(null); setError(''); }

  async function saveAffiliate() {
    setError('');
    if (!form.last_name?.trim() || !form.first_name?.trim()) {
      setError('Apellido y nombre son requeridos.');
      return;
    }
    const url = editModal === 'create' ? '/api/admin/affiliates' : `/api/admin/affiliates/${editing!.id}`;
    const method = editModal === 'create' ? 'POST' : 'PATCH';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string };
      setError(data.error ?? 'No se pudo guardar.');
      return;
    }
    closeEdit();
    router.refresh();
    if (editModal === 'edit' && editing) {
      setAffiliates(prev => prev.map(a => a.id === editing.id ? { ...a, ...form } : a));
    }
  }

  async function deleteAffiliate(a: AffiliateRow) {
    if (!confirm(`Eliminar a ${a.last_name}, ${a.first_name}?`)) return;
    const res = await fetch(`/api/admin/affiliates/${a.id}`, { method: 'DELETE' });
    if (!res.ok) { alert('No se pudo eliminar.'); return; }
    setAffiliates(prev => prev.filter(x => x.id !== a.id));
    router.refresh();
  }

  async function handleImport() {
    const file = fileRef.current?.files?.[0];
    if (!file) { setImportResult('Elegí un archivo CSV primero.'); return; }
    setImportBusy(true); setImportResult('');
    try {
      const text = await file.text();
      const res = await fetch('/api/admin/affiliates/import', {
        method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: text,
      });
      const data = await res.json() as { ok?: boolean; inserted?: number; updated?: number; skipped?: number; total?: number; error?: string };
      if (!res.ok) { setImportResult(`Error: ${data.error ?? res.status}`); return; }
      setImportResult(`OK. ${data.total} filas → ${data.inserted} nuevos, ${data.updated} actualizados, ${data.skipped ?? 0} descartados.`);
      router.refresh();
      const listRes = await fetch('/api/admin/affiliates');
      if (listRes.ok) {
        const list = await listRes.json() as { affiliates: AffiliateRow[] };
        setAffiliates(list.affiliates);
      }
    } catch (err) {
      setImportResult(`Error: ${err instanceof Error ? err.message : 'desconocido'}`);
    } finally { setImportBusy(false); }
  }

  function formatVigencia(v: string | null): string {
    if (!v) return '—';
    try {
      return new Date(v).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch { return v; }
  }

  const f = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  return (
    <div className="max-w-7xl space-y-5">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-zinc-900">Afiliados y delegados</h1>
          <p className="text-zinc-500 mt-1 text-sm">
            Base de delegados que la IA usa como contexto al procesar los reportes.
          </p>
          <p className="text-xs text-zinc-400 mt-1">
            {affiliates.length} cargados · {affiliates.filter(a => a.is_active).length} activos
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => { setImportOpen(true); setImportResult(''); }} className="bg-zinc-100 text-zinc-800 hover:bg-zinc-200">
            <Upload className="h-4 w-4 mr-1.5" /> Importar CSV
          </Button>
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Nuevo</Button>
        </div>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="py-3 px-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por apellido, nombre, aeropuerto, organismo, rama, tipo…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-zinc-200 rounded focus:outline-none focus:ring-2 focus:ring-zinc-300"
            />
          </div>
        </CardContent>
      </Card>

      {/* Tabla desktop — columnas: Apellido · Nombre · RAMA · Tipo · Organismo · Aeropuerto · Vigencia · Teléfono */}
      <Card className="hidden md:block">
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-zinc-50 text-left">
                <th className="px-3 py-3 font-medium text-zinc-600">Apellido</th>
                <th className="px-3 py-3 font-medium text-zinc-600">Nombre</th>
                <th className="px-3 py-3 font-medium text-zinc-600 w-20">RAMA</th>
                <th className="px-3 py-3 font-medium text-zinc-600 w-24">Tipo</th>
                <th className="px-3 py-3 font-medium text-zinc-600 w-16">Org.</th>
                <th className="px-3 py-3 font-medium text-zinc-600">Aeropuerto</th>
                <th className="px-3 py-3 font-medium text-zinc-600 w-28">Vigencia</th>
                <th className="px-3 py-3 font-medium text-zinc-600 w-28">Teléfono</th>
                <th className="px-3 py-3 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-zinc-400">
                    {affiliates.length === 0
                      ? 'Importá un CSV o creá uno nuevo para empezar.'
                      : 'Sin coincidencias.'}
                  </td>
                </tr>
              )}
              {visible.map((a, i) => (
                <tr key={a.id} className={`${i % 2 === 0 ? 'bg-white' : 'bg-zinc-50/50'} ${!a.is_active ? 'opacity-50' : ''}`}>
                  <td className="px-3 py-2 font-medium text-zinc-800">{a.last_name}</td>
                  <td className="px-3 py-2 text-zinc-700">{a.first_name}</td>
                  <td className="px-3 py-2 text-zinc-600 font-mono text-xs">{a.rama ?? '—'}</td>
                  <td className="px-3 py-2">
                    {a.tipo ? (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TIPO_COLOR[a.tipo] ?? 'bg-zinc-100 text-zinc-600'}`}>
                        {a.tipo}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2 text-zinc-500 text-xs">{a.organismo ?? '—'}</td>
                  <td className="px-3 py-2 text-zinc-600">{a.aeropuerto ?? a.dependency ?? '—'}</td>
                  <td className="px-3 py-2 text-zinc-500 text-xs tabular-nums">{formatVigencia(a.vigencia)}</td>
                  <td className="px-3 py-2 text-zinc-500 text-xs tabular-nums">{a.phone_e164 ?? '—'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1">
                      <button onClick={() => openEdit(a)} className="h-7 w-7 inline-flex items-center justify-center rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100" title="Editar">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => deleteAffiliate(a)} className="h-7 w-7 inline-flex items-center justify-center rounded text-zinc-400 hover:text-red-600 hover:bg-red-50" title="Eliminar">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Cards mobile */}
      <div className="md:hidden space-y-2">
        {visible.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-sm text-zinc-400">
            {affiliates.length === 0 ? 'Importá un CSV para empezar.' : 'Sin coincidencias.'}
          </CardContent></Card>
        ) : (
          visible.map(a => (
            <Card key={a.id} className={a.is_active ? '' : 'opacity-60'}>
              <CardContent className="py-3 px-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-zinc-900 text-sm">{a.last_name}, {a.first_name}</p>
                    <p className="text-xs text-zinc-500">
                      {[a.aeropuerto ?? a.dependency, a.organismo, a.rama].filter(Boolean).join(' · ')}
                    </p>
                    {a.tipo && (
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium mt-0.5 inline-block ${TIPO_COLOR[a.tipo] ?? ''}`}>
                        {a.tipo}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(a)} className="h-7 w-7 inline-flex items-center justify-center rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => deleteAffiliate(a)} className="h-7 w-7 inline-flex items-center justify-center rounded text-zinc-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Modal crear/editar */}
      {editModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg my-4 max-h-[calc(100vh-2rem)] flex flex-col">
            <div className="px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">
                {editModal === 'create' ? 'Nuevo delegado' : `Editar — ${editing?.last_name}, ${editing?.first_name}`}
              </h2>
            </div>
            <div className="px-6 py-5 space-y-4 overflow-y-auto">
              {/* Nombre */}
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Apellido *</Label><Input value={form.last_name} onChange={f('last_name')} className="mt-1" /></div>
                <div><Label>Nombre *</Label><Input value={form.first_name} onChange={f('first_name')} className="mt-1" /></div>
              </div>
              {/* Datos gremiales */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>RAMA</Label>
                  <Input value={form.rama ?? ''} onChange={f('rama')} placeholder="CTA, AIS…" className="mt-1" />
                </div>
                <div>
                  <Label>Tipo</Label>
                  <select value={form.tipo ?? ''} onChange={f('tipo')} className="mt-1 w-full border border-zinc-200 rounded px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300">
                    <option value="">— seleccionar —</option>
                    {TIPO_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Organismo</Label>
                  <select value={form.organismo ?? ''} onChange={f('organismo')} className="mt-1 w-full border border-zinc-200 rounded px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300">
                    <option value="">— seleccionar —</option>
                    {ORGANISMO_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              {/* Aeropuerto y vigencia */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Aeropuerto / Estación</Label>
                  <Input value={form.aeropuerto ?? ''} onChange={f('aeropuerto')} placeholder="Ezeiza, Bariloche…" className="mt-1" />
                </div>
                <div>
                  <Label>Vigencia del mandato</Label>
                  <Input type="date" value={form.vigencia ?? ''} onChange={f('vigencia')} className="mt-1" />
                </div>
              </div>
              {/* Contacto */}
              <div className="grid grid-cols-2 gap-3">
                <div><Label>DNI</Label><Input value={form.dni ?? ''} onChange={f('dni')} className="mt-1" /></div>
                <div><Label>Teléfono</Label><Input value={form.phone_e164 ?? ''} onChange={f('phone_e164')} placeholder="+549..." className="mt-1" /></div>
              </div>
              <div><Label>Notas</Label><Input value={form.notes ?? ''} onChange={f('notes')} className="mt-1" /></div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))} className="rounded" />
                Activo (la IA lo usa como contexto)
              </label>
              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
            <div className="px-6 py-4 border-t flex justify-end gap-3">
              <Button onClick={closeEdit} className="bg-zinc-100 text-zinc-700 hover:bg-zinc-200">Cancelar</Button>
              <Button onClick={saveAffiliate}>{editModal === 'create' ? 'Crear' : 'Guardar'}</Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal import */}
      {importOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md my-4 max-h-[calc(100vh-2rem)] flex flex-col">
            <div className="px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Importar delegados desde CSV</h2>
            </div>
            <div className="px-6 py-5 space-y-4 overflow-y-auto">
              <p className="text-sm text-zinc-600">Columnas reconocidas (en cualquier orden):</p>
              <ul className="text-xs text-zinc-500 list-disc pl-5 space-y-0.5">
                <li><strong>apellido</strong> y <strong>nombre</strong> (requeridos)</li>
                <li><strong>rama</strong>, <strong>tipo</strong> (Base / Congresal / Ambos), <strong>organismo</strong></li>
                <li><strong>aeropuerto</strong>, <strong>vigencia</strong> (fecha de vencimiento del mandato)</li>
                <li>dni, telefono, notas</li>
              </ul>
              <p className="text-xs text-zinc-400">Re-importar el mismo CSV actualiza sin duplicar.</p>
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="w-full text-sm border border-zinc-200 rounded px-3 py-2" />
              {importResult && (
                <p className={`text-sm ${importResult.startsWith('Error') ? 'text-red-600' : 'text-emerald-700'}`}>
                  {importResult}
                </p>
              )}
            </div>
            <div className="px-6 py-4 border-t flex justify-end gap-3">
              <Button onClick={() => { setImportOpen(false); setImportResult(''); }} className="bg-zinc-100 text-zinc-700 hover:bg-zinc-200">Cerrar</Button>
              <Button onClick={handleImport} disabled={importBusy}>{importBusy ? 'Importando…' : 'Importar'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
