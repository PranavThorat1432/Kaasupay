import { useState, useEffect, useCallback } from 'react';
import RewardsHeader from '../components/rewards/RewardsHeader';
import RewardsMetricBar from '../components/rewards/RewardsMetricBar';
import ActiveOfferBanner from '../components/rewards/ActiveOfferBanner';
import ScratchCardGrid from '../components/rewards/ScratchCardGrid';
import ScratchModal from '../components/rewards/modal/ScratchModal';
import AdminOfferModal from '../components/rewards/admin/AdminOfferModal';
import AdminOfferReportDialog from '../components/rewards/admin/AdminOfferReportDialog';
import { Skeleton } from '../components/ui/Spinner';
import rewardService from '../services/rewardService';
import { useToast } from '../store/hooks';

export function RewardsPage() {
  const toast = useToast();
  const [cards, setCards] = useState([]);
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);

  const [selectedCard, setSelectedCard] = useState(null);
  const [isScratchModalOpen, setIsScratchModalOpen] = useState(false);
  const [isAdminOfferOpen, setIsAdminOfferOpen] = useState(false);
  const [isAdminReportOpen, setIsAdminReportOpen] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [cardsRes, offersRes] = await Promise.all([
        rewardService.getCards().catch(() => ({ cards: [] })),
        rewardService.getActiveOffers().catch(() => ({ offers: [] })),
      ]);
      setCards(cardsRes.cards || []);
      setOffers(offersRes.offers || []);
    } catch (err) {
      console.error('Failed to load rewards data:', err);
      toast.error('Unable to sync reward cards');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
    // Refresh card list in background to update statuses
    loadData();
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

      {/* Responsive Grid of Scratch Cards */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-44 rounded-2xl w-full" />
          ))}
        </div>
      ) : (
        <ScratchCardGrid
          cards={cards}
          onSelectCard={handleSelectCard}
        />
      )}

      {/* Interactive Scratch Card Modal */}
      <ScratchModal
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
          loadData();
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
