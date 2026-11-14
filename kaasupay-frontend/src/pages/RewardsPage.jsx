import { useState, useEffect, useCallback } from 'react';
import { AlertCircle } from 'lucide-react';
import RewardsHeader from '../components/rewards/RewardsHeader';
import RewardsMetricBar from '../components/rewards/RewardsMetricBar';
import ActiveOfferBanner from '../components/rewards/ActiveOfferBanner';
import ScratchCardGrid from '../components/rewards/ScratchCardGrid';
import ScratchModal from '../components/rewards/modal/ScratchModal';
import AdminOfferModal from '../components/rewards/admin/AdminOfferModal';
import AdminOfferReportDialog from '../components/rewards/admin/AdminOfferReportDialog';
import Button from '../components/ui/Button';
import rewardService from '../services/rewardService';
import { useToast } from '../store/hooks';

export function RewardsPage() {
  const toast = useToast();
  const [cards, setCards] = useState([]);
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [selectedCard, setSelectedCard] = useState(null);
  const [isScratchModalOpen, setIsScratchModalOpen] = useState(false);
  const [isAdminOfferOpen, setIsAdminOfferOpen] = useState(false);
  const [isAdminReportOpen, setIsAdminReportOpen] = useState(false);

  const loadData = useCallback(async (isInitial = false) => {
    try {
      if (isInitial) {
        setLoading(true);
        setLoadError(null);
      }
      const [cardsRes, offersRes] = await Promise.all([
        rewardService.getCards(),
        rewardService.getActiveOffers(),
      ]);
      setCards(cardsRes?.cards || []);
      setOffers(offersRes?.offers || []);
      setLoadError(null);
    } catch (err) {
      console.error('Failed to load rewards data:', err);
      if (isInitial) {
        // Differentiate API failure from empty cards
        setLoadError(err.message || 'Unable to connect to rewards service. Please check your connection.');
      } else {
        // Preserve previously loaded rewards during background refresh failures
        toast.error('Unable to refresh rewards. Showing previously loaded cards.');
      }
    } finally {
      if (isInitial) {
        setLoading(false);
      }
    }
  }, [toast]);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const [cardsRes, offersRes] = await Promise.all([
          rewardService.getCards(),
          rewardService.getActiveOffers(),
        ]);
        if (isMounted) {
          setCards(cardsRes?.cards || []);
          setOffers(offersRes?.offers || []);
          setLoadError(null);
        }
      } catch (err) {
        if (isMounted) {
          setLoadError(err.message || 'Unable to connect to rewards service. Please check your connection.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  // Derived metrics
  const totalWonPaise = cards
    .filter((c) => c.status === 'CLAIMED' && typeof c.amount === 'number')
    .reduce((sum, c) => sum + c.amount, 0);

  const unclaimedCards = cards.filter((c) => c.status === 'UNCLAIMED');
  const scratchedCount = cards.filter((c) => c.status === 'CLAIMED' || c.status === 'EXHAUSTED').length;

  const handleSelectCard = (card) => {
    setSelectedCard(card);
    setIsScratchModalOpen(true);
  };

  const handleClaimComplete = (cardId, claimResult) => {
    if (cardId && claimResult) {
      setCards((prev) =>
        prev.map((c) =>
          String(c.id || c._id) === String(cardId)
            ? { ...c, status: claimResult.status || c.status, amount: claimResult.amount ?? c.amount }
            : c
        )
      );
    }
    // Refresh card list in background to sync authoritative backend state
    loadData(false);
  };

  return (
    <div className="space-y-6">
      {/* Header with Title and Staff Buttons */}
      <RewardsHeader
        unclaimedCount={unclaimedCards.length}
        onOpenAdminOffer={() => setIsAdminOfferOpen(true)}
        onOpenAdminReport={() => setIsAdminReportOpen(true)}
      />

      {/* Metric Cards Bar */}
      <RewardsMetricBar
        totalWonPaise={totalWonPaise}
        unclaimedCount={unclaimedCards.length}
        scratchedCount={scratchedCount}
        activeOffersCount={offers.length}
      />

      {/* Live Festival Promotional Offers Banner */}
      <ActiveOfferBanner offers={offers} />

      {/* Responsive Grid of Scratch Cards or Retryable Error Banner */}
      {loadError && cards.length === 0 ? (
        <div className="p-8 text-center bg-white rounded-2xl border border-rose-200 shadow-xs space-y-4">
          <div className="w-14 h-14 mx-auto rounded-full bg-rose-50 text-rose-500 flex items-center justify-center">
            <AlertCircle className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h3 className="font-bold text-navy-950 text-base">Unable to load rewards</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">{loadError}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadData(true)}
            className="cursor-pointer font-bold text-navy-950"
          >
            Retry Loading
          </Button>
        </div>
      ) : (
        <ScratchCardGrid
          cards={cards}
          onSelectCard={handleSelectCard}
          isLoading={loading}
        />
      )}

      {/* Interactive Scratch Card Modal with Card Key for Fresh Mounting */}
      <ScratchModal
        key={selectedCard ? String(selectedCard.id || selectedCard._id) : 'none'}
        card={selectedCard}
        isOpen={isScratchModalOpen}
        onClose={() => {
          setIsScratchModalOpen(false);
          setSelectedCard(null);
        }}
        onClaimComplete={handleClaimComplete}
      />

      {/* Staff Campaign Creation Drawer */}
      <AdminOfferModal
        isOpen={isAdminOfferOpen}
        onClose={() => setIsAdminOfferOpen(false)}
        onSuccess={() => {
          toast.success('Campaign offer launched successfully!');
          loadData(false);
        }}
      />

      {/* Staff Live Campaign Audit Dialog */}
      <AdminOfferReportDialog
        isOpen={isAdminReportOpen}
        onClose={() => setIsAdminReportOpen(false)}
      />
    </div>
  );
}

export default RewardsPage;

