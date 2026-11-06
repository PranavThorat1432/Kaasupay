import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, ShieldCheck, AlertCircle } from 'lucide-react';
import Button from '../../ui/Button';
import Input from '../../ui/Input';
import rewardService from '../../../services/rewardService';

export default function AdminOfferModal({ isOpen, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    code: '',
    percent: 5,
    maxCashbackRupees: 50,
    minPaymentRupees: 100,
    budgetRupees: 1000,
    days: 7,
    adminKey: localStorage.getItem('kaasupay_admin_key') || '',
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (!formData.adminKey) {
        throw new Error('Staff Admin Key is required');
      }

      localStorage.setItem('kaasupay_admin_key', formData.adminKey);

      const payload = {
        code: formData.code.trim().toUpperCase(),
        percent: Number(formData.percent),
        maxCashback: Math.round(Number(formData.maxCashbackRupees) * 100), // to paise
        minPayment: Math.round(Number(formData.minPaymentRupees) * 100),
        budget: Math.round(Number(formData.budgetRupees) * 100),
        days: Number(formData.days),
      };

      await rewardService.adminCreateOffer(payload, formData.adminKey);
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to create campaign offer');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy-950/70 backdrop-blur-xs">
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="w-full max-w-md bg-white rounded-3xl p-6 shadow-2xl relative space-y-4"
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-navy-950 text-white">
                <Plus className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-extrabold text-navy-950 text-base">Launch Campaign</h3>
                <p className="text-[11px] text-slate-400">Staff Offer & Promo Deposit</p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="cursor-pointer p-1.5 text-slate-400 hover:text-navy-900 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div>
              <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block mb-1">
                Admin Key (Staff Secret)
              </label>
              <input
                type="password"
                required
                value={formData.adminKey}
                onChange={(e) => setFormData({ ...formData, adminKey: e.target.value })}
                placeholder="Enter ADMIN_KEY"
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl font-mono focus:outline-none focus:ring-2 focus:ring-cobalt-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block mb-1">
                  Offer Code
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. DIWALI"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl font-mono uppercase focus:outline-none focus:ring-2 focus:ring-cobalt-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block mb-1">
                  Cashback (%)
                </label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  required
                  value={formData.percent}
                  onChange={(e) => setFormData({ ...formData, percent: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-cobalt-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block mb-1">
                  Min Payment (₹)
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  value={formData.minPaymentRupees}
                  onChange={(e) => setFormData({ ...formData, minPaymentRupees: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-cobalt-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block mb-1">
                  Max Cashback (₹)
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  value={formData.maxCashbackRupees}
                  onChange={(e) => setFormData({ ...formData, maxCashbackRupees: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-cobalt-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block mb-1">
                  Total Budget (₹)
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  value={formData.budgetRupees}
                  onChange={(e) => setFormData({ ...formData, budgetRupees: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl font-mono focus:outline-none focus:ring-2 focus:ring-cobalt-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block mb-1">
                  Duration (Days)
                </label>
                <input
                  type="number"
                  min="1"
                  max="30"
                  required
                  value={formData.days}
                  onChange={(e) => setFormData({ ...formData, days: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-cobalt-500"
                />
              </div>
            </div>

            <div className="pt-2">
              <Button
                type="submit"
                variant="primary"
                size="md"
                isLoading={loading}
                className="w-full font-bold bg-navy-950 text-white"
              >
                Create Offer & Deposit Budget
              </Button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

