import React, { useEffect, useState } from 'react';
import { api, type ArtworkResponse } from '../lib/api';

const WORKSHOPS = [
  { name: 'Clases Semanales de Torno', desc: 'Práctica continua, centrado y torneado · 2h/semana', fee: '1 crédito / sesión' },
  { name: 'Monográfico de Esmaltes BOTZ', desc: 'Formulación y alta temperatura (1250°C) · 3h', fee: '2 créditos' },
  { name: 'Clase Suelta · Primera Toma', desc: 'Iniciación al torno alfarero y desbastado · 2h', fee: '1 crédito' },
  { name: 'Piezas a Medida y Encargos', desc: 'Vajillas para alta gastronomía y colecciones privadas', fee: 'A medida' },
];

export const BrandHome: React.FC<{ onGoToBookings: () => void }> = ({ onGoToBookings }) => {
  const [artworks, setArtworks] = useState<ArtworkResponse[]>([]);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [buyer, setBuyer] = useState({ name: '', email: '' });
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api.GET('/api/v1/artworks').then(({ data }) => {
      if (data?.length) setArtworks(data);
    });
  }, []);

  const handleBuy = async (id: string, e: React.FormEvent) => {
    e.preventDefault();
    const { data } = await api.POST('/api/v1/artworks/{id}/buy', { params: { path: { id } }, body: { buyerName: buyer.name, buyerEmail: buyer.email } });
    setArtworks((prev) => prev.map((a) => (a.id === id ? { ...a, stock: Math.max(0, a.stock - 1) } : a)));
    setMsg(`Pieza reservada con éxito. Ref: ${data?.orderRef || 'BT-' + Date.now().toString().slice(-5)}`);
    setBuyingId(null); setBuyer({ name: '', email: '' });
  };

  return (
    <div className="space-y-32 py-6 text-[#231F1E] font-sans">
      {/* Apertura Íntima: Diario Visual en Broken Grid */}
      <section id="cuaderno" className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-12 items-start scroll-mt-24">
        <div className="md:col-span-5 space-y-3">
          <div className="overflow-hidden group"><img src="media/estudio/totem-abrazo.jpg" alt="Tótem abrazo" className="w-full aspect-[3/4] object-cover art-img" /></div>
          <span className="font-serif italic text-xs text-[#231F1E]/50">Fig. I · Tótem abrazo en gres</span>
        </div>
        <div className="md:col-span-3 space-y-6 md:pt-16">
          <span className="text-[10px] uppercase tracking-[0.25em] text-[#231F1E]/40 font-light block">Diario Visual</span>
          <p className="font-serif text-2xl sm:text-3xl italic font-light leading-relaxed text-[#231F1E]">“Modelar el barro en calma; dejar que el fuego y el óxido terminen la frase.”</p>
          <p className="text-xs font-light text-[#231F1E]/70 leading-relaxed">Taller entre Madrid y Burgos. Clases de torno en <a href="https://instagram.com/espaciolalavanderia" target="_blank" rel="noreferrer" className="underline decoration-[#231F1E]/30 hover:opacity-75">@espaciolalavanderia</a>, investigación de barros y quema a alta temperatura.</p>
        </div>
        <div className="md:col-span-4 md:mt-28 space-y-6">
          <div className="overflow-hidden group"><img src="media/estudio/bea-torno.jpg" alt="Beatriz torno" className="w-full aspect-square object-cover art-img" /></div>
          <div className="overflow-hidden group"><img src="media/estudio/relieves-botanicos.jpg" alt="Relieves" className="w-full aspect-[4/3] object-cover art-img" /></div>
          <p className="font-serif italic text-xs text-[#231F1E]/50 text-right">Notas del taller · Madrid & Burgos</p>
        </div>
      </section>

      {/* Exposición de Obra: Cuadrícula Asimétrica Escalonada */}
      <section id="obra" className="space-y-12 scroll-mt-24">
        <div className="border-b hairline pb-4 flex justify-between items-baseline"><h2 className="font-serif text-2xl sm:text-3xl font-light">Exposición de Obra</h2><span className="font-serif italic text-xs text-[#231F1E]/50">Piezas únicas de autor</span></div>
        {msg && <div className="p-3 border hairline bg-[#231F1E]/5 text-xs flex justify-between"><span>{msg}</span><button onClick={() => setMsg(null)}>✕</button></div>}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-y-24 gap-x-8">
          {artworks.map((a, i) => (
            <div key={a.id} className={`${i % 2 === 0 ? 'md:col-span-6' : 'md:col-span-5 md:col-start-8 md:mt-24'} space-y-4`}>
              <div className="overflow-hidden group"><img src={a.imageUrl || 'media/obras/jarras-klein.jpg'} alt={a.title} className="w-full aspect-[4/5] object-cover art-img" /></div>
              <div className="space-y-1">
                <span className="font-serif italic text-sm text-[#231F1E]/50 block">Nº 0{i + 1}</span>
                <div className="flex justify-between items-baseline"><h3 className="font-serif text-xl sm:text-2xl font-light">{a.title}</h3><span className="font-serif text-base font-light">{a.priceEur} €</span></div>
                <p className="text-xs font-light text-[#231F1E]/60">{a.glazeFinish}</p>
              </div>
              {buyingId === a.id ? (
                <form onSubmit={(e) => void handleBuy(a.id, e)} className="pt-2 space-y-2 max-w-xs">
                  <input type="text" required placeholder="Nombre completo" value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} className="w-full py-1 text-xs bg-transparent border-b hairline focus:outline-hidden focus:border-[#231F1E]" />
                  <input type="email" required placeholder="Email de contacto" value={buyer.email} onChange={(e) => setBuyer({ ...buyer, email: e.target.value })} className="w-full py-1 text-xs bg-transparent border-b hairline focus:outline-hidden focus:border-[#231F1E]" />
                  <div className="flex gap-4 pt-1"><button type="submit" className="text-xs uppercase tracking-widest font-medium underline underline-offset-4">Adquirir pieza</button><button type="button" onClick={() => setBuyingId(null)} className="text-xs text-[#231F1E]/40">✕</button></div>
                </form>
              ) : a.stock > 0 ? (
                <button onClick={() => setBuyingId(a.id)} className="text-xs uppercase tracking-widest text-[#231F1E]/70 hover:text-[#231F1E] underline underline-offset-4 decoration-[#231F1E]/30">[ Reservar obra ]</button>
              ) : <span className="text-xs italic text-[#231F1E]/40 font-serif">Obra adquirida</span>}
            </div>
          ))}
        </div>
      </section>

      {/* Índice de Talleres y Díptico */}
      <section id="talleres" className="grid grid-cols-1 md:grid-cols-12 gap-12 items-start scroll-mt-24 pt-8">
        <div className="md:col-span-7 space-y-6">
          <div className="border-b hairline pb-3"><h2 className="font-serif text-2xl sm:text-3xl font-light">Índice de Talleres</h2></div>
          <div className="divide-y hairline">
            {WORKSHOPS.map((w, idx) => (
              <div key={idx} className="py-5 flex flex-col sm:flex-row justify-between sm:items-baseline gap-2">
                <div><h3 className="font-serif text-lg font-light text-[#231F1E]">{w.name}</h3><p className="text-xs text-[#231F1E]/60 font-light mt-0.5">{w.desc}</p></div>
                <div className="flex items-center gap-4 shrink-0"><span className="font-serif italic text-xs text-[#231F1E]/60">{w.fee}</span><button onClick={onGoToBookings} className="text-xs uppercase tracking-widest underline underline-offset-4 decoration-[#231F1E]/30 hover:opacity-75">[ Ver fechas ]</button></div>
              </div>
            ))}
          </div>
        </div>
        <div className="md:col-span-5 space-y-8 md:mt-8">
          <div className="overflow-hidden group"><img src="media/estudio/bodegon-gato.jpg" alt="Bodegón gato" className="w-full aspect-[4/5] object-cover art-img" /></div>
          <div className="overflow-hidden group ml-6 md:ml-12"><img src="media/estudio/muestras-esmaltes.jpg" alt="Muestras" className="w-full aspect-[4/3] object-cover art-img" /></div>
          <p className="font-serif italic text-xs text-[#231F1E]/50 text-right">Cuaderno de esmaltes de alta temperatura (1250°C)</p>
        </div>
      </section>
    </div>
  );
};

export default BrandHome;
