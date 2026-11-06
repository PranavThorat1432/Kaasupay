import { useState, useMemo } from 'react';
import { Gift, Sparkles, Filter } from 'lucide-react';
import ScratchCardItem from './ScratchCardItem';

export default function ScratchCardGrid({ cards = [], onSelectCard }) {
  const [filter, setFilter] = useState('ALL');

  const filteredCards = useMemo(() => {
    if (filter === 'UNCLAIMED') return cards.filter((c) => c.status === 'UNCLAIMED');
    if (filter === 'CLAIMED') return cards.filter((c) => c.status === 'CLAIMED');
    if (filter === 'PAST') return cards.filter((c) => c.status === 'EXHAUSTED' || c.status === 'EXPIRED');
    return cards;
  }, [cards, filter]);

  return (
    <div className="space-y-4">
      {/* Filter Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <Gift className="w-4 h-4 text-cobalt-600" />
          <h2 className="text-sm font-extrabold uppercase tracking-wider text-navy-950">
            Your Reward Cards ({filteredCards.length})
          </h2>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {['ALL', 'UNCLAIMED', 'CLAIMED', 'PAST'].map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`cursor-pointer px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                filter === tab
                  ? 'bg-navy-950 text-white shadow-xs'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              {tab === 'ALL'
                ? 'All Cards'
                : tab === 'UNCLAIMED'
                ? 'Unclaimed'
                : tab === 'CLAIMED'
                ? 'Claimed'
                : 'Exhausted/Expired'}
            </button>
          ))}
        </div>
      </div>

      {/* Grid of Cards */}
      {filteredCards.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-2xl border border-slate-200/80 shadow-xs space-y-3">
          <div className="w-14 h-14 mx-auto rounded-full bg-slate-100 text-slate-400 flex items-center justify-center">
            <Gift className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h3 className="font-bold text-navy-950 text-base">No scratch cards in this view</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Make money transfers of ₹100 or more during active promotional periods to earn scratch cards!
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredCards.map((card) => (
            <ScratchCardItem
              key={card.id || card._id}
              card={card}
              onSelect={onSelectCard}
            />
          ))}
        </div>
      )}
    </div>
  );
}
