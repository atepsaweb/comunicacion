'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type UserRow = {
  id: string;
  full_name: string;
  phone_e164: string;
  role: 'secretary' | 'executive' | 'press_admin';
  position: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

const ROLE_LABELS: Record<string, string> = {
  secretary: 'Secretario/a',
  executive: 'Ejecutivo/a',
  press_admin: 'Admin prensa',
};

interface UserFormData {
  full_name: string;
  phone_e164: string;
  role: string;
  position: string;
  notes: string;
  is_active: boolean;
}

const EMPTY_FORM: UserFormData = {
  full_name: '',
  phone_e164: '',
  role: 'secretary',
  position: '',
  notes: '',
  is_active: true,
};

interface Props {
  users: UserRow[];
}

export function UsuariosClient({ users: initialUsers }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [users, setUsers] = useState(initialUsers);
  const [modal, setModal] = useState<'create' | 'edit' | null>(null);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form, setForm] = useState<UserFormData>(EMPTY_FORM);
  const [error, setError] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const visible = showInactive ? users : users.filter(u => u.is_active);

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditing(null);
    setError('');
    setModal('create');
  }

  function openEdit(user: UserRow) {
    setForm({
      full_name: user.full_name,
      phone_e164: user.phone_e164,
      role: user.role,
      position: user.position ?? '',
      notes: user.notes ?? '',
      is_active: user.is_active,
    });
    setEditing(user);
    setError('');
    setModal('edit');
  }

  function closeModal() {
    setModal(null);
    setEditing(null);
    setError('');
  }

  async function handleCreate() {
    setError('');
    if (!form.full_name.trim() || !form.phone_e164.trim()) {
      setError('Nombre y teléfono son requeridos.');
      return;
    }

    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: form.full_name.trim(),
        phone_e164: form.phone_e164.trim(),
        role: form.role,
        position: form.position.trim() || null,
        notes: form.notes.trim() || null,
        is_active: form.is_active,
      }),
    });

    if (!res.ok) {
      const data = await res.json() as { error: string };
      setError(data.error ?? 'Error al crear usuario');
      return;
    }

    closeModal();
    startTransition(() => { router.refresh(); });
    // Optimistic update
    const data = await res.json().catch(() => null);
    if (data?.user) {
      setUsers(prev => [...prev, {
        id: data.user.id,
        full_name: form.full_name.trim(),
        phone_e164: form.phone_e164.trim(),
        role: form.role as UserRow['role'],
        position: form.position.trim() || null,
        notes: form.notes.trim() || null,
        is_active: form.is_active,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }].sort((a, b) => a.full_name.localeCompare(b.full_name)));
    }
  }

  async function handleEdit() {
    if (!editing) return;
    setError('');
    if (!form.full_name.trim()) {
      setError('El nombre es requerido.');
      return;
    }

    const body: Partial<UserFormData> & { phone_e164?: string } = {
      full_name: form.full_name.trim(),
      role: form.role,
      position: form.position.trim() || undefined,
      notes: form.notes.trim() || undefined,
      is_active: form.is_active,
    };
    if (form.phone_e164.trim() !== editing.phone_e164) {
      body.phone_e164 = form.phone_e164.trim();
    }

    const res = await fetch(`/api/admin/users/${editing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json() as { error: string };
      setError(data.error ?? 'Error al actualizar usuario');
      return;
    }

    const data = await res.json() as { phoneChanged?: boolean };
    closeModal();
    if (data.phoneChanged) {
      alert('Teléfono actualizado. Los OTP activos del usuario fueron eliminados.');
    }

    setUsers(prev =>
      prev
        .map(u =>
          u.id === editing.id
            ? {
                ...u,
                full_name: form.full_name.trim(),
                phone_e164: form.phone_e164.trim(),
                role: form.role as UserRow['role'],
                position: form.position.trim() || null,
                notes: form.notes.trim() || null,
                is_active: form.is_active,
                updated_at: new Date().toISOString(),
              }
            : u,
        )
        .sort((a, b) => a.full_name.localeCompare(b.full_name)),
    );
  }

  async function toggleActive(user: UserRow) {
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !user.is_active }),
    });
    if (!res.ok) return;
    setUsers(prev => prev.map(u => u.id === user.id ? { ...u, is_active: !u.is_active } : u));
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Usuarios</h1>
          <p className="text-zinc-500 mt-1 text-sm">
            {users.filter(u => u.is_active).length} activos · {users.filter(u => !u.is_active).length} inactivos
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-zinc-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={e => setShowInactive(e.target.checked)}
              className="rounded"
            />
            Mostrar inactivos
          </label>
          <Button onClick={openCreate}>+ Nuevo usuario</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-zinc-50 text-left">
                <th className="px-4 py-3 font-medium text-zinc-600">Nombre</th>
                <th className="px-4 py-3 font-medium text-zinc-600">Cargo</th>
                <th className="px-4 py-3 font-medium text-zinc-600">Teléfono</th>
                <th className="px-4 py-3 font-medium text-zinc-600">Rol</th>
                <th className="px-4 py-3 font-medium text-zinc-600">Estado</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((user, i) => (
                <tr
                  key={user.id}
                  className={`${i % 2 === 0 ? 'bg-white' : 'bg-zinc-50/50'} ${!user.is_active ? 'opacity-50' : ''}`}
                >
                  <td className="px-4 py-2.5 font-medium text-zinc-800">{user.full_name}</td>
                  <td className="px-4 py-2.5 text-zinc-500">{user.position ?? '—'}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-zinc-600">{user.phone_e164}</td>
                  <td className="px-4 py-2.5">
                    <span className="inline-block px-2 py-0.5 rounded bg-zinc-100 text-zinc-700 text-xs">
                      {ROLE_LABELS[user.role] ?? user.role}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => toggleActive(user)}
                      className={`text-xs font-medium px-2 py-0.5 rounded ${
                        user.is_active
                          ? 'bg-green-100 text-green-700 hover:bg-green-200'
                          : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
                      }`}
                    >
                      {user.is_active ? 'Activo' : 'Inactivo'}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button
                      onClick={() => openEdit(user)}
                      className="h-7 px-3 text-xs"
                    >
                      Editar
                    </Button>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-zinc-400">
                    No hay usuarios para mostrar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Modal crear / editar */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">
                {modal === 'create' ? 'Nuevo usuario' : `Editar — ${editing?.full_name}`}
              </h2>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <Label>Nombre completo *</Label>
                <Input
                  value={form.full_name}
                  onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                  placeholder="Pérez, Juan"
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Teléfono (E.164) *</Label>
                <Input
                  value={form.phone_e164}
                  onChange={e => setForm(f => ({ ...f, phone_e164: e.target.value }))}
                  placeholder="+5491100000000"
                  className="mt-1"
                />
                {modal === 'edit' && form.phone_e164 !== editing?.phone_e164 && (
                  <p className="text-xs text-amber-600 mt-1">
                    Cambiar el teléfono eliminará los OTP activos del usuario.
                  </p>
                )}
              </div>
              <div>
                <Label>Cargo / posición</Label>
                <Input
                  value={form.position}
                  onChange={e => setForm(f => ({ ...f, position: e.target.value }))}
                  placeholder="Secretario de Organización"
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Rol</Label>
                <select
                  value={form.role}
                  onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                  className="mt-1 w-full border rounded px-3 py-2 text-sm bg-white"
                >
                  <option value="secretary">Secretario/a</option>
                  <option value="executive">Ejecutivo/a</option>
                  <option value="press_admin">Admin prensa</option>
                </select>
              </div>
              <div>
                <Label>Notas internas</Label>
                <Input
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Opcional"
                  className="mt-1"
                />
              </div>
              {modal === 'edit' && (
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                    className="rounded"
                  />
                  Usuario activo
                </label>
              )}
              {error && (
                <p className="text-sm text-red-600">{error}</p>
              )}
            </div>
            <div className="px-6 py-4 border-t flex justify-end gap-3">
              <Button onClick={closeModal} className="bg-zinc-100 text-zinc-700 hover:bg-zinc-200">
                Cancelar
              </Button>
              <Button
                onClick={modal === 'create' ? handleCreate : handleEdit}
                disabled={isPending}
              >
                {modal === 'create' ? 'Crear usuario' : 'Guardar cambios'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
