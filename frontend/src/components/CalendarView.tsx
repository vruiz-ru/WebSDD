import React, { useEffect, useState } from 'react';
import { api, type SessionDetail, type UserBookingItem } from '../lib/api';
import { useAuth } from '../context/AuthContext';

export const CalendarView: React.FC = () => {
  const { user, setUser, updateCredits } = useAuth();
  const [sessions, setSessions] = useState<SessionDetail[]>([]);
  const [bookings, setBookings] = useState<UserBookingItem[]>([]);
  const [dayOffset, setDayOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toDateString());
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ err?: boolean; text: string } | null>(null);

  const days = Array.from({ length: 14 }, (_, i) => new Date(Date.now() + (dayOffset + i) * 86400000));
  const activeDate = days.some((d) => d.toDateString() === selectedDate) ? selectedDate : days[0].toDateString();
  const monthLabel = days[0].toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

  const loadData = async () => {
    setLoading(true);
    const d = new Date(); d.setHours(0, 0, 0, 0);
    const from = new Date(d.getTime() + dayOffset * 86400000).toISOString();
    const to = new Date(d.getTime() + (dayOffset + 14) * 86400000).toISOString();
    const { data: s } = await api.GET('/api/v1/sessions', { params: { query: { from, to } } });
    const { data: b } = await api.GET('/api/v1/bookings/me');
    setSessions(s ?? []); setBookings(b ?? []); setLoading(false);
  };
  useEffect(() => { void loadData(); }, [dayOffset]);

  const handleBook = async (sessionId: string) => {
    setMsg(null);
    const { data, error, response } = await api.POST('/api/v1/bookings', { body: { sessionId } });
    if (error) return setMsg({ err: true, text: error.error?.message || (response.status === 403 ? 'Créditos insuficientes' : 'Error') });
    if (data && user) { setUser({ ...user, credits: data.remainingCredits }); setMsg({ text: `Confirmada. Saldo: ${data.remainingCredits}` }); void loadData(); }
  };

  const handleCancel = async (id: string) => {
    setMsg(null);
    const { data, error } = await api.DELETE('/api/v1/bookings/{id}', { params: { path: { id } } });
    if (error) return setMsg({ err: true, text: error.error?.message || 'Error al cancelar' });
    if (data) { updateCredits(data.newCreditBalance); setMsg({ text: `Cancelada. Saldo: ${data.newCreditBalance}` }); void loadData(); }
  };

  const active = bookings.filter((b) => b.status === 'confirmed');
  const bookedIds = new Set(active.map((b) => b.sessionId));
  const daySessions = sessions.filter((s) => new Date(s.startsAt).toDateString() === activeDate);

  return (
    <div className="space-y-6 text-[#231F1E]">
      {msg && (
        <div className={`p-3 border hairline text-xs font-light flex justify-between items-center ${msg.err ? 'bg-rose-50 text-rose-800' : 'bg-[#231F1E]/5 text-[#231F1E]'}`}>
          <span>{msg.text}</span><button onClick={() => setMsg(null)}>✕</button>
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-8 space-y-4">
          <div className="p-4 border hairline bg-[#F5F2EB] space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-serif text-sm font-light capitalize tracking-wide">{monthLabel}</span>
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-light">
                <button onClick={() => setDayOffset((o) => o - 7)} className="px-2.5 py-1 border hairline hover:border-[#231F1E]">◀ Anterior</button>
                {dayOffset !== 0 && <button onClick={() => { setDayOffset(0); setSelectedDate(new Date().toDateString()); }} className="px-2.5 py-1 bg-[#231F1E] text-[#F5F2EB]">Hoy</button>}
                <button onClick={() => setDayOffset((o) => o + 7)} className="px-2.5 py-1 border hairline hover:border-[#231F1E]">Siguiente ▶</button>
              </div>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
              {days.map((d, i) => (
                <button key={i} onClick={() => setSelectedDate(d.toDateString())} className={`shrink-0 w-14 py-2 px-1 text-center border transition-all ${d.toDateString() === activeDate ? 'bg-[#231F1E] text-[#F5F2EB] border-[#231F1E]' : 'bg-transparent text-[#231F1E]/70 hairline hover:border-[#231F1E]'}`}>
                  <span className="block text-[9px] uppercase tracking-wider">{d.toLocaleDateString('es-ES', { weekday: 'short' }).slice(0, 3)}</span><span className="block text-sm font-serif font-light leading-tight">{d.getDate()}</span><span className="block text-[9px] opacity-60">{sessions.filter((s) => new Date(s.startsAt).toDateString() === d.toDateString()).length}c</span>
                </button>
              ))}
            </div>
          </div>
          {loading ? <div className="p-8 text-center text-xs text-[#231F1E]/50 border hairline">Cargando agenda...</div> :
            daySessions.length === 0 ? <div className="p-8 text-center border hairline text-xs text-[#231F1E]/50 font-light">No hay clases programadas para este día.</div> : (
            <div className="space-y-3">
              {daySessions.map((s) => {
                const occ = Math.round(((s.maxCapacity - s.availableSlots) / s.maxCapacity) * 100);
                return (
                  <div key={s.id} style={{ borderLeftColor: s.activityType.color }} className="p-4 border hairline border-l-4 bg-[#F5F2EB]">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-left w-20 shrink-0"><p className="text-xs font-serif font-medium leading-tight">{new Date(s.startsAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</p><p className="text-[10px] text-[#231F1E]/50 font-light">{new Date(s.endsAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} · {s.activityType.durationMinutes}m</p></div>
                      <div className="flex-1 min-w-0 px-2"><h4 className="text-xs font-serif font-medium truncate">{s.activityType.name}</h4><p className="text-[11px] text-[#231F1E]/60 font-light truncate">{s.trainer.fullName} · {s.activityType.creditCost} crédito(s)</p><div className="flex items-center gap-2 mt-1.5"><div className="flex-1 max-w-[120px] bg-[#231F1E]/10 h-1 overflow-hidden"><div className="bg-[#231F1E]/60 h-full transition-all duration-300" style={{ width: `${occ}%` }} /></div><span className="text-[10px] text-[#231F1E]/50">{s.availableSlots}/{s.maxCapacity} libres</span></div></div>
                      <div className="shrink-0">{bookedIds.has(s.id) ? <span className="px-3 py-1.5 border hairline text-[#231F1E] text-[10px] uppercase tracking-widest font-serif italic">✓ Inscrita</span> : s.availableSlots === 0 ? <span className="px-3 py-1.5 text-[#231F1E]/40 text-[10px] uppercase tracking-widest">Completa</span> : <button onClick={() => void handleBook(s.id)} className="px-4 py-2 border border-[#231F1E] bg-[#231F1E] text-[#F5F2EB] hover:bg-transparent hover:text-[#231F1E] text-[10px] uppercase tracking-widest transition-all">Reservar</button>}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="lg:col-span-4 p-5 border hairline bg-[#F5F2EB] space-y-4">
          <h3 className="font-serif text-sm font-light text-[#231F1E] border-b hairline pb-2">Mis Próximas Clases ({active.length})</h3>
          {active.length === 0 ? <p className="text-xs text-[#231F1E]/50 py-4 text-center font-light">No tienes reservas activas en el taller.</p> : (
            <div className="space-y-2.5">
              {active.map((b) => (
                <div key={b.id} style={{ borderLeftColor: b.session.activityType.color }} className="p-3 border hairline border-l-4 flex items-center justify-between gap-2">
                  <div className="min-w-0"><p className="text-xs font-serif font-medium truncate">{b.session.activityType.name}</p><p className="text-[10px] text-[#231F1E]/60 capitalize font-light">{new Date(b.session.startsAt).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' })} · {new Date(b.session.startsAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</p></div>
                  <button onClick={() => void handleCancel(b.id)} className="px-2.5 py-1 border hairline text-[#231F1E]/60 hover:text-rose-700 text-[10px] uppercase tracking-wider shrink-0">Cancelar</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CalendarView;
