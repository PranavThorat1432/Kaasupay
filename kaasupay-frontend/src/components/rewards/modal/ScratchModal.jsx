import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles } from 'lucide-react';
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
  const isClaimingRef = useRef(false);

  const [claimResult, setClaimResult] = useState(() =>
    card && card.status !== 'UNCLAIMED'
      ? { amount: card.amount, status: card.status }
      : null
  );
  const [isLoadingClaim, setIsLoadingClaim] = useState(false);
  const [isFullyRevealed, setIsFullyRevealed] = useState(() =>
    Boolean(card && card.status !== 'UNCLAIMED')
  );
  const [showConfetti, setShowConfetti] = useState(false);

  // Trigger claim API call when card is scratched
  const handlePerformClaim = useCallback(async () => {
    if (isClaimingRef.current || !card || card.status !== 'UNCLAIMED') return;
    if (
      claimResult &&
      (claimResult.status === 'CLAIMED' ||
        claimResult.status === 'EXHAUSTED' ||
        claimResult.status === 'EXPIRED')
    ) {
      return;
    }

    isClaimingRef.current = true;
    setIsLoadingClaim(true);

    try {
      const res = await rewardService.claimCard(card.id || card._id);
      setClaimResult(res);

      // Constraint 6: Only confirmed successful claim with status === "CLAIMED" and amount > 0 may trigger fetchWalletBalance()
      if (res?.status === 'CLAIMED' && typeof res?.amount === 'number' && res.amount > 0) {
        dispatch(fetchWalletBalance());
      }
    } catch (err) {
      console.error('Error during card claim:', err);

      // Constraints 4 & 5: Check authoritative backend card state on conflict or ambiguous network/server error
      if (err.isConflict || err.isNetworkError || err.isServerError) {
        try {
          const authCard = await rewardService.getCardById(card.id || card._id);
          if (authCard && authCard.status !== 'UNCLAIMED') {
            const resolved = {
              status: authCard.status,
              amount: authCard.amount ?? 0,
              message:
                authCard.status === 'CLAIMED'
                  ? 'You won cashback!'
                  : authCard.status === 'EXHAUSTED'
                  ? 'Better luck next time'
                  : 'This card has expired',
            };
            setClaimResult(resolved);
            if (authCard.status === 'CLAIMED' && typeof authCard.amount === 'number' && authCard.amount > 0) {
              dispatch(fetchWalletBalance());
            }
            return;
          }
        } catch (syncErr) {
          console.warn('Failed to synchronize authoritative card state:', syncErr);
        }
      }

      // Explicit expired card handling (HTTP 410)
      if (err.isExpired || err.status === 410) {
        setClaimResult({
          status: 'EXPIRED',
          amount: 0,
          message: 'This card has expired',
        });
      } else {
        // Constraint 7: Never convert HTTP 500, network errors, timeouts, or connection interruptions into EXHAUSTED
        setClaimResult({
          status: 'ERROR',
          isNetworkError: Boolean(err.isNetworkError),
          message:
            err.message || 'Unable to claim reward right now. Your card remains safe and unclaimed.',
        });
      }
    } finally {
      setIsLoadingClaim(false);
      isClaimingRef.current = false;
    }
  }, [card, claimResult, dispatch]);

  const handleRetryClaim = useCallback(async () => {
    setClaimResult(null);
    await handlePerformClaim();
  }, [handlePerformClaim]);

  // Called when cleared area exceeds 45%
  const handleAutoReveal = useCallback(() => {
    setIsFullyRevealed(true);
    triggerHaptic([30, 60, 30]);

    if (
      (claimResult?.status === 'CLAIMED' && claimResult?.amount > 0) ||
      (card?.amount > 0 && card?.status === 'CLAIMED')
    ) {
      playVictoryChime();
      setShowConfetti(true);
    }

    if (onClaimComplete) {
      onClaimComplete(card?.id || card?._id, claimResult);
    }
  }, [claimResult, card, onClaimComplete]);

  // Fallback Manual Scratch button if user prefers instant reveal
  const handleInstantReveal = async () => {
    if (!claimResult) {
      await handlePerformClaim();
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
                onRetry={handleRetryClaim}
              />

              {/* Layer 2: Scratch Foil (only if card is unclaimed) */}
              {card.status === 'UNCLAIMED' && (
                <ScratchCardCanvas
                  width={320}
                  height={360}
                  onFirstScratch={handlePerformClaim}
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
                  className="text-xs text-slate-600 cursor-pointer"
                >
                  Scratch Instantly
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="md"
                  onClick={onClose}
                  className="w-full mt-2 font-bold bg-amber-500 hover:bg-amber-600 border-none text-navy-950 shadow-md cursor-pointer"
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

