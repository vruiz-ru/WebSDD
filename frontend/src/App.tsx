import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { api, resetLocalData } from './lib/api';
import { CalendarView } from './components/CalendarView';
import { StudioPanel } from './components/StudioPanel';
import { BrandHome } from './components/BrandHome';

const AppContent: React.FC = () => {
  const { user, setUser, isAuthenticated, logout } = useAuth();
  const [view, setView] = useState<'gallery' | 'booking'>('gallery');
  const [open, setOpen] = useState(false); const [xy, setXy] = useState({ x: -50, y: -50 });
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false); const [error, setError] = useState<string | null>(null);

  useEffect(() => { const h = (e: MouseEvent) => setXy({ x: e.clientX, y: e.clientY }); window.addEventListener('mousemove', h); return () => window.removeEventListener('mousemove', h); }, []);

  const handleLogin = async (e?: React.FormEvent, qEmail?: string, qPass?: string) => {
    if (e) e.preventDefault(); setError(null); setLoading(true);
    const em = (qEmail || email).trim(); const pw = qPass || password;
    const { data, error: err } = await api.POST('/auth/login', { body: { email: em, password: pw } });
    setLoading(false); if (err) return setError(err.error?.message || 'Error al autenticar');
    if (data) setUser(data.user);
  };

  const nav = (target: 'gallery' | 'booking', hash?: string) => {
    setView(target); setOpen(false);
    if (hash) setTimeout(() => { window.location.hash = hash; }, 50);
  };

  const roleTag = user?.role === 'admin' ? 'Admin' : user?.role === 'trainer' ? 'Beatriz' : 'Alumna';

  return (
    <div className="min-h-screen bg-[#F5F2EB] text-[#231F1E] flex flex-col font-sans selection:bg-[#231F1E] selection:text-[#F5F2EB]">
      <div className="w-5 h-5 border border-[#231F1E]/40 rounded-full pointer-events-none fixed z-50 transition-transform duration-150 ease-out hidden md:block -translate-x-1/2 -translate-y-1/2" style={{ left: xy.x, top: xy.y }} />
      <header className="sticky top-0 z-40 bg-[#F5F2EB]/95 backdrop-blur-md border-b hairline px-6 sm:px-12 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <button onClick={() => nav('gallery')} className="font-serif tracking-widest text-lg sm:text-xl font-light text-[#231F1E] hover:opacity-75 transition-opacity">Beatriz Tabliega</button>
          <nav className="hidden md:flex items-center gap-8 text-[11px] tracking-[0.2em] uppercase font-light text-[#231F1E]/70">
            <button onClick={() => nav('gallery', '#cuaderno')} className="hover:text-[#231F1E]">Cuaderno</button><button onClick={() => nav('gallery', '#obra')} className="hover:text-[#231F1E]">Obra</button><button onClick={() => nav('gallery', '#talleres')} className="hover:text-[#231F1E]">Talleres</button>
            <button onClick={() => nav('booking')} className="hover:text-[#231F1E] underline underline-offset-4 decoration-[#231F1E]/30">{isAuthenticated ? `Espacio Privado (${roleTag})` : 'Espacio Privado'}</button>
            {isAuthenticated && <button onClick={logout} className="text-[#231F1E]/40 hover:text-[#231F1E]">Salir</button>}
          </nav>
          <button onClick={() => setOpen(!open)} className="md:hidden text-lg p-1">{open ? '✕' : '☰'}</button>
        </div>
        {open && (
          <div className="md:hidden pt-4 pb-2 flex flex-col gap-3 border-t hairline mt-3 text-xs tracking-[0.2em] uppercase font-light">
            <button onClick={() => nav('gallery', '#cuaderno')} className="text-left py-1 text-[#231F1E]/70">Cuaderno</button><button onClick={() => nav('gallery', '#obra')} className="text-left py-1 text-[#231F1E]/70">Obra</button><button onClick={() => nav('gallery', '#talleres')} className="text-left py-1 text-[#231F1E]/70">Talleres</button>
            <button onClick={() => nav('booking')} className="text-left py-1 text-[#231F1E] font-medium">{isAuthenticated ? `Espacio Privado (${roleTag})` : 'Espacio Privado'}</button>
            {isAuthenticated && <button onClick={logout} className="text-left py-1 text-[#231F1E]/40">Cerrar Sesión</button>}
          </div>
        )}
      </header>

      <main className="max-w-7xl w-full mx-auto px-6 sm:px-12 py-10 flex-1 flex flex-col">
        {view === 'gallery' ? (
          <BrandHome onGoToBookings={() => nav('booking')} />
        ) : !isAuthenticated || !user ? (
          <div className="m-auto w-full max-w-sm p-8 border hairline bg-[#F5F2EB] space-y-5">
            <div className="text-center space-y-1">
              <span className="text-[10px] uppercase tracking-[0.25em] text-[#231F1E]/60 font-light">Acceso Intimidad</span>
              <h2 className="text-2xl font-serif font-light text-[#231F1E]">Espacio Privado</h2>
              <p className="text-xs text-[#231F1E]/60 font-light">Alumnos y agenda del taller cerámico</p>
            </div>
            {error && <div className="p-3 border hairline bg-[#231F1E]/5 text-xs">{error}</div>}
            <div className="p-2.5 border hairline bg-[#231F1E]/5 text-center space-y-1.5">
              <span className="text-[9px] uppercase tracking-widest text-[#231F1E]/60 block font-light">Entrar como demo (1 toque):</span>
              <div className="flex justify-center gap-1.5 text-[10px] uppercase tracking-wider font-medium">
                <button type="button" onClick={() => void handleLogin(undefined, 'sofia.alumna@example.com', 'CeramicaSegura2026!')} className="px-2 py-1 border hairline hover:border-[#231F1E] bg-[#F5F2EB]">Alumna</button>
                <button type="button" onClick={() => void handleLogin(undefined, 'carmen.profesora@tallerbarro.com', 'CeramicaSegura2026!')} className="px-2 py-1 border hairline hover:border-[#231F1E] bg-[#F5F2EB]">Beatriz</button>
                <button type="button" onClick={() => void handleLogin(undefined, 'admin@tallerbarro.com', 'CeramicaSegura2026!')} className="px-2 py-1 border hairline hover:border-[#231F1E] bg-[#F5F2EB]">Admin</button>
              </div>
            </div>
            <form onSubmit={handleLogin} className="space-y-4">
              <div><label className="block text-[10px] uppercase tracking-[0.2em] text-[#231F1E]/60 mb-1">Email</label><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@email.com" className="w-full px-3 py-2 bg-transparent border-b hairline text-xs focus:outline-hidden focus:border-[#231F1E]" /></div>
              <div><label className="block text-[10px] uppercase tracking-[0.2em] text-[#231F1E]/60 mb-1">Contraseña</label><input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="w-full px-3 py-2 bg-transparent border-b hairline text-xs focus:outline-hidden focus:border-[#231F1E]" /></div>
              <button type="submit" disabled={loading} className="w-full py-3 border border-[#231F1E] bg-[#231F1E] text-[#F5F2EB] hover:bg-transparent hover:text-[#231F1E] text-xs uppercase tracking-[0.25em] transition-all disabled:opacity-50">{loading ? 'Entrando...' : 'Entrar'}</button>
            </form>
            <div className="flex justify-between items-center text-[10px] uppercase tracking-widest text-[#231F1E]/50 pt-2 border-t hairline"><button onClick={() => nav('gallery')} className="hover:text-[#231F1E]">← Volver</button><button type="button" onClick={resetLocalData} className="hover:text-rose-700">↺ Reset fábrica</button></div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex justify-between items-center border-b hairline pb-3 text-xs">
              <div className="flex items-center gap-3">
                <span className="font-serif text-base font-light">{user.fullName}</span><span className="text-[10px] uppercase tracking-widest px-2 py-0.5 border hairline text-[#231F1E]/70">{roleTag}</span>
                {user.role === 'client' && <span className="text-[11px] font-serif italic text-[#231F1E]">{user.credits} créditos</span>}
              </div>
              <div className="flex items-center gap-4">
                <button type="button" onClick={resetLocalData} className="text-[10px] uppercase tracking-wider text-[#231F1E]/40 hover:text-rose-700">↺ Reset</button>
                <button onClick={() => nav('gallery')} className="text-[11px] uppercase tracking-widest text-[#231F1E]/60 hover:text-[#231F1E]">← Volver</button>
              </div>
            </div>
            {user.role === 'client' ? <CalendarView /> : <StudioPanel />}
          </div>
        )}
      </main>
    </div>
  );
};

export const App: React.FC = () => <AuthProvider><AppContent /></AuthProvider>;
export default App;
