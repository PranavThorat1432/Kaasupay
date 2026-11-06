import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, BarChart3, CheckCircle2, AlertTriangle, StopCircle } from 'lucide-react';
import Button from '../../ui/Button';
import AmountDisplay from '../../ui/AmountDisplay';
import rewardService from '../../../services/rewardService';

export default function AdminOfferReportDialog({ isOpen, onClose }) {
  const [code, setCode] = useState('DIWALI');
  const [adminKey, setAdminKey] = useState(localStorage.getItem('kaasupay_admin_key') || '');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  if (!isOpen) return null;

  const handleFetchReport = async (e) => {
    if (e) e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      if (!adminKey) throw new Error('Staff Admin Key is required');
      localStorage.setItem('kaasupay_admin_key', adminKey);

      const res = await rewardService.adminGetOfferReport(code.trim().toUpperCase(), adminKey);
      setReport(res);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to fetch report');
      setReport(null);
    } finally {
      setLoading(false);
    }
  };

  const handleStopOffer = async () => {
    if (!window.confirm(`Are you sure you want to stop campaign ${code}?`)) return;

    setStopping(true);
    setError(null);
    try {
      const res = await rewardService.adminStopOffer(code.trim().toUpperCase(), adminKey);
      setMessage(`Offer stopped. Remaining budget: ₹${(res.budgetLeft / 100).toFixed(2)}`);
      await handleFetchReport();
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to stop offer');
    } finally {
      setStopping(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy-950/70 backdrop-blur-xs">
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="w-full max-w-lg bg-white rounded-3xl p-6 shadow-2xl relative space-y-4 max-h-[90vh] overflow-y-auto"
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-slate-100 text-slate-800">
                <BarChart3 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-extrabold text-navy-950 text-base">Campaign Audit Report</h3>
                <p className="text-[11px] text-slate-400">Budget Conservation Proof</p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="cursor-pointer p-1.5 text-slate-400 hover:text-navy-900 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Form to query report */}
          <form onSubmit={handleFetchReport} className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div>
              <input
                type="password"
                required
                placeholder="Staff Admin Key"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl font-mono focus:outline-none focus:ring-2 focus:ring-cobalt-500"
              />
            </div>

            <div>
              <input
                type="text"
                required
                placeholder="Offer Code (e.g. DIWALI)"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl font-mono uppercase focus:outline-none focus:ring-2 focus:ring-cobalt-500"
              />
            </div>

            <Button
              type="submit"
              variant="secondary"
              size="sm"
              isLoading={loading}
              className="w-full font-bold"
            >
              Fetch Audit
            </Button>
          </form>

          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
              {error}
            </div>
          )}

          {message && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs">
              {message}
            </div>
          )}

          {/* Report Breakdown */}
          {report && (
            <div className="space-y-4 pt-2">
              {/* Check indicator banner */}
              <div
                className={`p-3.5 rounded-2xl border flex items-center justify-between text-xs font-bold ${
                  report.check
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-rose-50 border-rose-200 text-rose-800'
                }`}
              >
                <div className="flex items-center gap-2">
                  {report.check ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  )}
                  <span>
                    {report.check
                      ? 'Conservation Verified: budget - budgetLeft === totalPaid'
                      : 'Audit Discrepancy Detected!'}
                  </span>
                </div>
                <span className="font-mono">{report.check ? 'CHECK: PASS' : 'CHECK: FAIL'}</span>
              </div>

              {/* Budget vs Paid */}
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100">
                  <span className="text-[10px] text-slate-400 uppercase font-bold">Initial Budget</span>
                  <div className="text-sm font-black text-navy-950 font-mono mt-0.5">
                    <AmountDisplay paise={report.budget} size="sm" />
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100">
                  <span className="text-[10px] text-slate-400 uppercase font-bold">Budget Left</span>
                  <div className="text-sm font-black text-amber-600 font-mono mt-0.5">
                    <AmountDisplay paise={report.budgetLeft} size="sm" />
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100">
                  <span className="text-[10px] text-slate-400 uppercase font-bold">Total Paid</span>
                  <div className="text-sm font-black text-emerald-600 font-mono mt-0.5">
                    <AmountDisplay paise={report.totalPaid} size="sm" />
                  </div>
                </div>
              </div>

              {/* Card State Breakdown */}
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-2">
                <h4 className="text-xs font-extrabold text-navy-950 uppercase tracking-wider">
                  Cards Distribution (Total: {report.cardsIssued})
                </h4>
                <div className="grid grid-cols-4 gap-2 text-center text-xs">
                  <div className="p-2 bg-white rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-400 block">Unclaimed</span>
                    <strong className="font-mono text-slate-800">{report.unclaimed}</strong>
                  </div>
                  <div className="p-2 bg-white rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-400 block">Claimed</span>
                    <strong className="font-mono text-emerald-600">{report.claimed}</strong>
                  </div>
                  <div className="p-2 bg-white rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-400 block">Exhausted</span>
                    <strong className="font-mono text-slate-600">{report.exhausted}</strong>
                  </div>
                  <div className="p-2 bg-white rounded-xl border border-slate-200">
                    <span className="text-[10px] text-slate-400 block">Expired</span>
                    <strong className="font-mono text-rose-500">{report.expired}</strong>
                  </div>
                </div>
              </div>

              {/* Stop Campaign Button */}
              <div className="pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleStopOffer}
                  isLoading={stopping}
                  leftIcon={<StopCircle className="w-3.5 h-3.5 text-rose-600" />}
                  className="w-full text-rose-600 hover:bg-rose-50 border-rose-200 font-semibold text-xs"
                >
                  Stop Campaign Early
                </Button>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
