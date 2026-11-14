import React, { useEffect, useState } from 'react';
import { api, type ActivityTypeInfo, type ClientUserItem, type SessionDetail, type SessionAttendeeItem, type ArtworkResponse } from '../lib/api';
import { useAuth } from '../context/AuthContext';

const QUICK_IMGS = ['media/obras/jarras-klein.jpg', 'media/obras/disco-siena.jpg', 'media/obras/equilibrio-cobalto.jpg', 'media/obras/trio-tulipan.jpg', 'media/obras/plato-terrazo.jpg', 'media/obras/disco-oxidos.jpg'];

export const StudioPanel: React.FC = () => {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<SessionDetail[]>([]); const [activities, setActivities] = useState<ActivityTypeInfo[]>([]); const [clients, setClients] = useState<ClientUserItem[]>([]); const [attendees, setAttendees] = useState<Record<string, SessionAttendeeItem[]>>({});
  const [artworks, setArtworks] = useState<ArtworkResponse[]>([]); const [dayOffset, setDayOffset] = useState(0); const [selectedDate, setSelectedDate] = useState(() => new Date().toDateString());
  const [form, setForm] = useState({ actId: '', date: new Date().toISOString().slice(0, 10), time: '10:00', cap: 6 });
  const [art, setArt] = useState({ title: '', cat: 'Escultura', price: 85, stock: 1, finish: 'Gres chamotado', hex: '#231F1E', img: QUICK_IMGS[0] });
  const [ui, setUi] = useState({ search: '', openId: null as string | null, msg: null as { err?: boolean; text: string } | null });
  const days = Array.from({ length: 14 }, (_, i) => new Date(Date.now() + (dayOffset + i) * 86400000)); const activeDate = days.some((d) => d.toDateString() === selectedDate) ? selectedDate : days[0].toDateString(); const monthLabel = days[0].toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

  const loadData = async (offset = dayOffset) => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    const { data: a } = await api.GET('/api/v1/activity-types');
    if (a?.length && !form.actId) { setActivities(a); setForm((f) => ({ ...f, actId: a[0].id })); } else if (a?.length) setActivities(a);
    const { data: s } = await api.GET('/api/v1/sessions', { params: { query: { from: new Date(d.getTime() + offset * 86400000).toISOString(), to: new Date(d.getTime() + (offset + 14) * 86400000).toISOString() } } });
    setSessions(s ?? []);
    const { data: arts } = await api.GET('/api/v1/artworks'); if (arts) setArtworks(arts);
    if (user?.role === 'admin') { const { data: c } = await api.GET('/api/v1/users/clients'); setClients(c ?? []); }
  };
  useEffect(() => { void loadData(dayOffset); }, [dayOffset, user?.role]);

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault(); setUi((s) => ({ ...s, msg: null }));
    const act = activities.find((a) => a.id === form.actId); const start = new Date(`${form.date}T${form.time}:00`);
    const { error } = await api.POST('/api/v1/sessions', { body: { activityTypeId: form.actId, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + (act?.durationMinutes ?? 120) * 60000).toISOString(), maxCapacity: form.cap } });
    if (error) return setUi((s) => ({ ...s, msg: { err: true, text: error.error?.message || 'Error al crear' } }));
    const today = new Date(); today.setHours(0, 0, 0, 0); const target = new Date(`${form.date}T00:00:00`);
    const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
    const newOffset = diff >= dayOffset && diff < dayOffset + 14 ? dayOffset : Math.floor(diff / 7) * 7;
    if (newOffset !== dayOffset) setDayOffset(newOffset);
    setSelectedDate(target.toDateString()); setUi((s) => ({ ...s, msg: { text: 'Clase programada en agenda' } })); void loadData(newOffset);
  };
  const handleCreateArtwork = async (e: React.FormEvent) => {
    e.preventDefault(); setUi((s) => ({ ...s, msg: null }));
    const { data, error } = await api.POST('/api/v1/artworks', { body: { title: art.title, category: art.cat, priceEur: Number(art.price), stock: Number(art.stock), glazeFinish: art.finish, paletteHex: art.hex, imageUrl: art.img } });
    if (error || !data) return setUi((s) => ({ ...s, msg: { err: true, text: error?.error?.message || 'Error al publicar' } }));
    setArtworks((prev) => [data, ...prev]); setUi((s) => ({ ...s, msg: { text: 'Pieza expuesta en tienda' } }));
    setArt({ title: '', cat: 'Escultura', price: 85, stock: 1, finish: 'Gres chamotado', hex: '#231F1E', img: QUICK_IMGS[0] });
  };
  const handleDeleteArtwork = async (id: string) => { const { error } = await api.DELETE('/api/v1/artworks/{id}', { params: { path: { id } } }); if (!error) { setArtworks((p) => p.filter((a) => a.id !== id)); setUi((s) => ({ ...s, msg: { text: 'Pieza retirada' } })); } };
  const handleImgFile = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onload = () => setArt((a) => ({ ...a, img: r.result as string })); r.readAsDataURL(f); } };
  const toggleAttendees = async (id: string) => { if (ui.openId === id) return setUi((s) => ({ ...s, openId: null })); setUi((s) => ({ ...s, openId: id })); if (!attendees[id]) { const { data } = await api.GET('/api/v1/sessions/{id}/attendees', { params: { path: { id } } }); if (data) setAttendees((p) => ({ ...p, [id]: data })); } };
  const handleAddCredits = async (id: string, delta: number) => { const { data } = await api.POST('/api/v1/users/{id}/credits', { params: { path: { id } }, body: { delta } }); if (data) setClients((p) => p.map((c) => (c.id === id ? { ...c, credits: data.credits } : c))); };

  const daySessions = sessions.filter((s) => new Date(s.startsAt).toDateString() === activeDate);
  const filteredClients = clients.filter((c) => (c.fullName + c.email).toLowerCase().includes(ui.search.toLowerCase()));

  return (
    <div className="space-y-6 text-[#231F1E]">
      {ui.msg && (<div className={`p-3 border hairline text-xs flex justify-between ${ui.msg.err ? 'bg-rose-50 text-rose-800' : 'bg-[#231F1E]/5 text-[#231F1E]'}`}><span>{ui.msg.text}</span><button onClick={() => setUi((s) => ({ ...s, msg: null }))}>✕</button></div>)}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-7 space-y-4">
          <div className="p-4 border hairline bg-[#F5F2EB] space-y-3">
            <div className="flex items-center justify-between"><span className="font-serif text-sm font-light capitalize tracking-wide">{monthLabel}</span><div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-light"><button onClick={() => setDayOffset((o) => o - 7)} className="px-2.5 py-1 border hairline hover:border-[#231F1E]">◀ Anterior</button>{dayOffset !== 0 && <button onClick={() => { setDayOffset(0); setSelectedDate(new Date().toDateString()); }} className="px-2.5 py-1 bg-[#231F1E] text-[#F5F2EB]">Hoy</button>}<button onClick={() => setDayOffset((o) => o + 7)} className="px-2.5 py-1 border hairline hover:border-[#231F1E]">Siguiente ▶</button></div></div>
            <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">{days.map((d, i) => (<button key={i} onClick={() => setSelectedDate(d.toDateString())} className={`shrink-0 w-14 py-2 px-1 text-center border transition-all ${d.toDateString() === activeDate ? 'bg-[#231F1E] text-[#F5F2EB] border-[#231F1E]' : 'bg-transparent text-[#231F1E]/70 hairline'}`}><span className="block text-[9px] uppercase tracking-wider">{d.toLocaleDateString('es-ES', { weekday: 'short' }).slice(0, 3)}</span><span className="block text-sm font-serif font-light leading-tight">{d.getDate()}</span></button>))}</div>
          </div>
          <div className="space-y-3">
            {daySessions.length === 0 ? <div className="p-8 text-center border hairline text-xs text-[#231F1E]/50 font-light">Sin sesiones para este día</div> :
              daySessions.map((s) => {
                const occ = Math.round(((s.maxCapacity - s.availableSlots) / s.maxCapacity) * 100);
                const time = `${new Date(s.startsAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} - ${new Date(s.endsAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
                return (
                  <div key={s.id} style={{ borderLeftColor: s.activityType.color }} className="p-4 border hairline border-l-4 bg-[#F5F2EB]">
                    <div className="flex justify-between items-start gap-2"><div><h4 className="text-xs font-serif font-medium text-[#231F1E]">{s.activityType.name} <span className="font-sans text-[11px] font-light text-[#231F1E]/60">({time})</span></h4><p className="text-[11px] text-[#231F1E]/60 font-light">Prof: {s.trainer.fullName}</p></div><button onClick={() => void toggleAttendees(s.id)} className="px-2.5 py-1 border hairline hover:border-[#231F1E] text-[10px] uppercase tracking-wider">👥 Asistentes</button></div>
                    <div className="mt-2"><div className="flex justify-between text-[10px] text-[#231F1E]/60 mb-0.5"><span>Ocupación</span><span>{s.maxCapacity - s.availableSlots}/{s.maxCapacity} ({occ}%)</span></div><div className="w-full bg-[#231F1E]/10 h-1 overflow-hidden"><div className="bg-[#231F1E]/60 h-full transition-all duration-300" style={{ width: `${occ}%` }} /></div></div>
                    {ui.openId === s.id && <div className="mt-2 pt-2 border-t hairline text-[11px] text-[#231F1E]/70 font-light"><strong>Inscritos: </strong>{attendees[s.id]?.length ? attendees[s.id].map((a) => a.fullName).join(', ') : 'Ninguno'}</div>}
                  </div>
                );
              })}
          </div>
        </div>
        <div className="lg:col-span-5 space-y-4">
          <form onSubmit={handleCreateSession} className="p-4 border hairline bg-[#F5F2EB] space-y-2">
            <h3 className="font-serif text-xs font-medium text-[#231F1E]">Programar Clase en Agenda</h3>
            <select value={form.actId} onChange={(e) => setForm({ ...form, actId: e.target.value })} className="w-full px-2 py-1.5 bg-transparent border hairline text-xs">{activities.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.durationMinutes}m)</option>)}</select>
            <div className="grid grid-cols-2 gap-2"><input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full px-2 py-1 bg-transparent border hairline text-xs" /><input type="time" required value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} className="w-full px-2 py-1 bg-transparent border hairline text-xs" /></div>
            <div className="flex gap-2"><input type="number" min={1} max={50} required value={form.cap} onChange={(e) => setForm({ ...form, cap: Number(e.target.value) })} className="w-20 px-2 py-1 bg-transparent border hairline text-xs" /><button type="submit" className="flex-1 py-1 border border-[#231F1E] bg-[#231F1E] text-[#F5F2EB] text-[10px] uppercase tracking-widest font-light">Crear Clase</button></div>
          </form>
          <form onSubmit={handleCreateArtwork} className="p-4 border hairline bg-[#F5F2EB] space-y-2">
            <div className="flex justify-between items-center"><h3 className="font-serif text-xs font-medium text-[#231F1E]">Publicar Obra en Tienda</h3><span className="text-[10px] text-[#231F1E]/50 font-serif italic">6 fotos</span></div>
            <div className="flex items-center gap-1.5"><input type="file" accept="image/*" onChange={handleImgFile} className="text-[10px] flex-1 file:mr-1 file:py-0.5 file:px-1.5 file:border-0 file:bg-[#231F1E]/5 file:text-[10px]" /><div className="flex gap-1 shrink-0">{QUICK_IMGS.map((img, i) => (<button type="button" key={i} onClick={() => setArt({ ...art, img })} className={`w-5 h-5 border ${art.img === img ? 'border-[#231F1E] ring-1 ring-[#231F1E]' : 'hairline'}`}><img src={img} alt="thumb" className="w-full h-full object-cover" /></button>))}</div></div>
            <div className="grid grid-cols-2 gap-2"><input type="text" required placeholder="Título de la pieza" value={art.title} onChange={(e) => setArt({ ...art, title: e.target.value })} className="px-2 py-1 bg-transparent border hairline text-xs" /><select value={art.cat} onChange={(e) => setArt({ ...art, cat: e.target.value })} className="px-2 py-1 bg-transparent border hairline text-xs"><option value="Escultura">Escultura</option><option value="Jarras">Jarras</option><option value="Vasijas">Vasijas</option><option value="Menaje">Menaje</option></select></div>
            <div className="grid grid-cols-3 gap-2"><input type="text" required placeholder="Acabado / Esmalte" value={art.finish} onChange={(e) => setArt({ ...art, finish: e.target.value })} className="px-2 py-1 bg-transparent border hairline text-xs" /><input type="number" min={1} required placeholder="Precio €" value={art.price} onChange={(e) => setArt({ ...art, price: Number(e.target.value) })} className="px-2 py-1 bg-transparent border hairline text-xs" /><input type="number" min={0} required placeholder="Stock uds" value={art.stock} onChange={(e) => setArt({ ...art, stock: Number(e.target.value) })} className="px-2 py-1 bg-transparent border hairline text-xs" /></div>
            <button type="submit" className="w-full py-1.5 border border-[#231F1E] bg-[#231F1E] text-[#F5F2EB] text-[10px] uppercase tracking-widest font-light">Publicar en Tienda</button>
          </form>
          <div className="p-4 border hairline bg-[#F5F2EB] space-y-2">
            <h3 className="font-serif text-xs font-medium text-[#231F1E]">Catálogo en Tienda ({artworks.length})</h3>
            <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">{artworks.map((a) => (<div key={a.id} className="p-1.5 border hairline flex items-center justify-between gap-2 text-xs"><div className="flex items-center gap-2 min-w-0"><img src={a.imageUrl || 'media/obras/jarras-klein.jpg'} alt={a.title} className="w-7 h-7 object-cover shrink-0 border hairline" /><div className="truncate"><p className="font-medium truncate">{a.title}</p><span className="text-[10px] text-[#231F1E]/50">{a.priceEur}€ · stock: {a.stock}</span></div></div><button onClick={() => void handleDeleteArtwork(a.id)} className="px-2 py-0.5 border hairline text-rose-700 hover:bg-rose-50 text-[10px] font-bold shrink-0">Retirar</button></div>))}</div>
          </div>
          {user?.role === 'admin' && (
            <div className="p-4 border hairline bg-[#F5F2EB] space-y-2">
              <div className="flex justify-between items-center"><h3 className="font-serif text-xs font-medium">Alumnos y Créditos</h3><span className="text-[10px] text-[#231F1E]/40 font-mono">{filteredClients.length}</span></div>
              <input type="text" placeholder="Buscar alumno..." value={ui.search} onChange={(e) => setUi({ ...ui, search: e.target.value })} className="w-full px-2 py-1 bg-transparent border hairline text-xs" />
              <div className="max-h-28 overflow-y-auto space-y-1 pr-1">{filteredClients.map((c) => (<div key={c.id} className="p-1.5 border hairline flex items-center justify-between text-xs"><div className="min-w-0"><p className="font-medium text-[#231F1E] truncate">{c.fullName}</p><span className="text-[10px] text-[#231F1E]/50 font-mono">{c.credits}c</span></div><div className="flex gap-1 shrink-0"><button onClick={() => void handleAddCredits(c.id, 1)} className="px-1.5 py-0.5 border hairline text-[10px] font-bold">+1</button><button onClick={() => void handleAddCredits(c.id, 4)} className="px-1.5 py-0.5 bg-[#231F1E] text-[#F5F2EB] text-[10px] font-bold">+4</button></div></div>))}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StudioPanel;
