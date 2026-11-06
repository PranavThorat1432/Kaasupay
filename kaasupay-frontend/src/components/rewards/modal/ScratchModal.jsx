import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles, Check, ArrowRight } from 'lucide-react';
import ScratchCardCanvas from './ScratchCardCanvas';
import RewardRevealView from './RewardRevealView';
import ConfettiBurst from './ConfettiBurst';
import Button from '../../ui/Button';
import rewardService from '../../../services/rewardService';
import { playVictoryChime, triggerHaptic } from '../../../utils/rewardsAudio';
import { useAppDispatch } from '../../../store/hooks';
import { fetchWalletBalance } from '../../../store/slices/walletSlice';

export default function ScratchModal({ card, isOpen, onClose, onClaimComplete }) {
  const dispatch = useAppDispatch();
  const [claimResult, setClaimResult] = useState(null);
  const [isLoadingClaim, setIsLoadingClaim] = useState(false);
  const [isFullyRevealed, setIsFullyRevealed] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  // If card was already claimed or exhausted in past
  useEffect(() => {
    if (card && card.status !== 'UNCLAIMED') {
      setIsFullyRevealed(true);
      setClaimResult({
        amount: card.amount,
        status: card.status,
      });
    } else {
      setIsFullyRevealed(false);
      setClaimResult(null);
      setShowConfetti(false);
    }
  }, [card]);

  // Trigger claim API call as soon as user first touches/scratches the card
  const handleFirstScratch = useCallback(async () => {
    if (!card || card.status !== 'UNCLAIMED' || claimResult || isLoadingClaim) return;

    setIsLoadingClaim(true);
    try {
      const res = await rewardService.claimCard(card.id || card._id);
      setClaimResult(res);
      // Immediately refresh wallet balance in Redux store
      dispatch(fetchWalletBalance());
    } catch (err) {
      console.error('Failed to claim card on first scratch:', err);
      // Still set fallback so user is not stuck
      setClaimResult({
        message: err.message || 'Error claiming card',
        amount: 0,
        status: 'EXHAUSTED',
      });
    } finally {
      setIsLoadingClaim(false);
    }
  }, [card, claimResult, isLoadingClaim, dispatch]);

  // Called when cleared area exceeds 45%
  const handleAutoReveal = useCallback(() => {
    setIsFullyRevealed(true);
    triggerHaptic([30, 60, 30]);

    if (claimResult?.amount > 0 || (card?.amount > 0 && card?.status === 'CLAIMED')) {
      playVictoryChime();
      setShowConfetti(true);
    }

    if (onClaimComplete) {
      onClaimComplete(card?.id, claimResult);
    }
  }, [claimResult, card, onClaimComplete]);

  // Fallback Manual Scratch button if user prefers instant reveal
  const handleInstantReveal = async () => {
    if (!claimResult) {
      await handleFirstScratch();
    }
    handleAutoReveal();
  };

  if (!isOpen || !card) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-navy-950/80 backdrop-blur-md">
        {showConfetti && <ConfettiBurst onComplete={() => setShowConfetti(false)} />}

        <motion.div
          initial={{ y: 50, opacity: 0, scale: 0.95 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 50, opacity: 0, scale: 0.95 }}
          className="relative w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl flex flex-col items-center max-h-[90vh] overflow-y-auto"
        >
          {/* Header & Close Button */}
          <div className="w-full flex items-center justify-between pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-extrabold text-navy-950 text-base">Scratch & Win</h3>
                <p className="text-[11px] text-slate-400">Festival Promotional Cashback</p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="cursor-pointer p-2 text-slate-400 hover:text-navy-900 rounded-xl hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Dual-Layer Interactive Scratch Studio */}
          <div className="py-6 flex flex-col items-center">
            <div className="relative rounded-2xl overflow-hidden shadow-2xl border-4 border-amber-300/40">
              {/* Layer 1: Underlying Prize */}
              <RewardRevealView
                card={card}
                claimResult={claimResult}
                isLoadingClaim={isLoadingClaim}
                isFullyRevealed={isFullyRevealed}
                width={320}
                height={360}
              />

              {/* Layer 2: Scratch Foil (only if card is unclaimed) */}
              {card.status === 'UNCLAIMED' && (
                <ScratchCardCanvas
                  width={320}
                  height={360}
                  onFirstScratch={handleFirstScratch}
                  onAutoReveal={handleAutoReveal}
                  isRevealed={isFullyRevealed}
                />
              )}
            </div>

            {/* Quick action button under card */}
            <div className="mt-4 flex flex-col items-center gap-2 w-full">
              {!isFullyRevealed && card.status === 'UNCLAIMED' ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleInstantReveal}
                  className="text-xs text-slate-600"
                >
                  Scratch Instantly
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="md"
                  onClick={onClose}
                  className="w-full mt-2 font-bold bg-amber-500 hover:bg-amber-600 border-none text-navy-950 shadow-md"
                >
                  Done
                </Button>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
