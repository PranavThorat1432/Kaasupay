import { Sparkles, Plus, BarChart3 } from 'lucide-react';
import Button from '../ui/Button';

export default function RewardsHeader({
  unclaimedCount = 0,
  onOpenAdminOffer,
  onOpenAdminReport,
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div>
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-amber-100 text-amber-700">
            <Sparkles className="w-5 h-5" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy-950 tracking-tight">
            Rewards Studio
          </h1>
          {unclaimedCount > 0 && (
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500 text-navy-950 animate-bounce">
              {unclaimedCount} Unscratched
            </span>
          )}
        </div>
        <p className="text-xs sm:text-sm text-slate-500 mt-1 font-medium">
          Earn instant cashbacks on transactions and scratch for festival rewards
        </p>
      </div>

      {/* Staff Actions */}
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={onOpenAdminReport}
          leftIcon={<BarChart3 className="w-3.5 h-3.5 text-slate-600" />}
        >
          Offer Report
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onOpenAdminOffer}
          leftIcon={<Plus className="w-3.5 h-3.5" />}
          className="bg-navy-900 hover:bg-navy-800 text-white"
        >
          New Campaign
        </Button>
      </div>
    </div>
  );
}

