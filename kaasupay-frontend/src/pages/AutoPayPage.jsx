import { useState, useEffect, useCallback } from 'react';
import { CalendarClock, AlertCircle, RefreshCw, PlusCircle, Search } from 'lucide-react';
import AutoPayHeader from '../components/autopay/AutoPayHeader';
import AutoPayMetricBar from '../components/autopay/AutoPayMetricBar';
import MandateCard from '../components/autopay/MandateCard';
import CreateMandateModal from '../components/autopay/CreateMandateModal';
import MandateRunsDialog from '../components/autopay/MandateRunsDialog';
import ConfirmActionDialog from '../components/autopay/ConfirmActionDialog';
import Button from '../components/ui/Button';
import Alert from '../components/ui/Alert';
import autopayService from '../services/autopayService';
import { useToast } from '../store/hooks';

const TAB_FILTERS = [
  { id: 'ALL', label: 'All' },
  { id: 'ACTIVE', label: 'Active' },
  { id: 'PAUSED', label: 'Paused' },
  { id: 'CANCELLED', label: 'Cancelled' },
];

export function AutoPayPage() {
  const toast = useToast();

  const [mandates, setMandates] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [activeTab, setActiveTab] = useState('ALL');

  // Create Modal state
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // History Dialog state
  const [selectedMandateForRuns, setSelectedMandateForRuns] = useState(null);
  const [runs, setRuns] = useState([]);
  const [isRunsLoading, setIsRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState(null);

  // Confirm Action Dialog state (pause / resume / cancel)
  const [actionDialog, setActionDialog] = useState({
    isOpen: false,
    actionType: 'pause',
    mandate: null,
    isLoading: false,
  });

  const fetchMandates = useCallback(async (isInitial = false) => {
    try {
      if (isInitial) {
        setIsLoading(true);
        setLoadError(null);
      }
      const res = await autopayService.getMandates();
      setMandates(res?.mandates || []);
      setLoadError(null);
    } catch (err) {
      console.error('[fetchMandates Error]', err);
      const msg = err.data?.message || err.message || 'Failed to load AutoPay mandates';
      if (isInitial) {
        setLoadError(msg);
      } else {
        toast.error('Unable to refresh mandates. Showing cached state.');
      }
    } finally {
      if (isInitial) {
        setIsLoading(false);
      }
    }
  }, [toast]);

  useEffect(() => {
    fetchMandates(true);
  }, [fetchMandates]);

  // Derived non-cancelled count for 5-mandate limit
  const nonCancelledCount = mandates.filter((m) => m.status !== 'CANCELLED').length;

  // Filtered mandates according to active tab
  const filteredMandates = mandates.filter((m) => {
    if (activeTab === 'ALL') return true;
    return m.status === activeTab;
  });

  // Action: Open History Dialog
  const handleOpenHistory = async (mandate) => {
    setSelectedMandateForRuns(mandate);
    setRuns([]);
    setRunsError(null);
    setIsRunsLoading(true);

    try {
      const res = await autopayService.getMandateRuns(mandate.id || mandate._id);
      setRuns(res?.runs || []);
    } catch (err) {
      console.error('[getMandateRuns Error]', err);
      setRunsError(err.data?.message || err.message || 'Unable to load execution history');
    } finally {
      setIsRunsLoading(false);
    }
  };

  // Action: Prompt Confirm Dialogs
  const handlePromptPause = (mandate) => {
    setActionDialog({
      isOpen: true,
      actionType: 'pause',
      mandate,
      isLoading: false,
    });
  };

  const handlePromptResume = (mandate) => {
    setActionDialog({
      isOpen: true,
      actionType: 'resume',
      mandate,
      isLoading: false,
    });
  };

  const handlePromptCancel = (mandate) => {
    setActionDialog({
      isOpen: true,
      actionType: 'cancel',
      mandate,
      isLoading: false,
    });
  };

  // Execute Confirmed Action
  const handleExecuteAction = async () => {
    const { actionType, mandate } = actionDialog;
    if (!mandate) return;

    setActionDialog((prev) => ({ ...prev, isLoading: true }));
    const id = mandate.id || mandate._id;

    try {
      if (actionType === 'pause') {
        const res = await autopayService.pauseMandate(id);
        toast.success(res.message || 'AutoPay paused');
      } else if (actionType === 'resume') {
        const res = await autopayService.resumeMandate(id);
        toast.success(res.message || 'AutoPay resumed');
      } else if (actionType === 'cancel') {
        const res = await autopayService.cancelMandate(id);
        toast.success(res.message || 'AutoPay cancelled');
      }

      setActionDialog({ isOpen: false, actionType: 'pause', mandate: null, isLoading: false });
      await fetchMandates(false);
    } catch (err) {
      console.error(`[${actionType} Error]`, err);
      const msg = err.data?.message || err.message || `Failed to ${actionType} AutoPay`;
      toast.error(msg);
      setActionDialog((prev) => ({ ...prev, isLoading: false }));
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-10">
      {/* Header with 5-Mandate Cap Badge */}
      <AutoPayHeader
        nonCancelledCount={nonCancelledCount}
        maxMandates={5}
        onOpenCreate={() => setIsCreateOpen(true)}
      />

      {/* Metrics Bar */}
      <AutoPayMetricBar mandates={mandates} />

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-100/80 rounded-xl w-fit text-xs font-semibold">
        {TAB_FILTERS.map((tab) => {
          const count =
            tab.id === 'ALL'
              ? mandates.length
              : mandates.filter((m) => m.status === tab.id).length;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                activeTab === tab.id
                  ? 'bg-white text-navy-900 shadow-xs'
                  : 'text-slate-600 hover:text-navy-900'
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                  activeTab === tab.id ? 'bg-slate-100 text-slate-700' : 'text-slate-400'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Loading Skeleton */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="p-5 bg-white border border-slate-200/80 rounded-2xl space-y-4 animate-pulse"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-200" />
                  <div className="space-y-1.5">
                    <div className="w-24 h-4 bg-slate-200 rounded" />
                    <div className="w-16 h-3 bg-slate-100 rounded" />
                  </div>
                </div>
                <div className="w-16 h-5 bg-slate-200 rounded-full" />
              </div>
              <div className="h-16 bg-slate-100 rounded-xl" />
              <div className="h-4 bg-slate-100 rounded w-1/2" />
              <div className="flex justify-between pt-2">
                <div className="w-16 h-8 bg-slate-200 rounded-lg" />
                <div className="w-16 h-8 bg-slate-200 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error State */}
      {!isLoading && loadError && (
        <div className="p-8 text-center bg-white border border-rose-200 rounded-2xl max-w-md mx-auto space-y-3">
          <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 mx-auto flex items-center justify-center">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-navy-900">Failed to Load AutoPay</h3>
          <p className="text-xs text-slate-500">{loadError}</p>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<RefreshCw className="w-4 h-4" />}
            onClick={() => fetchMandates(true)}
            className="mt-2"
          >
            Retry Connection
          </Button>
        </div>
      )}

      {/* Empty State: No Mandates Created Yet */}
      {!isLoading && !loadError && mandates.length === 0 && (
        <div className="p-12 text-center bg-white border-2 border-dashed border-slate-200 rounded-3xl max-w-lg mx-auto space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-cobalt-50 text-cobalt-600 mx-auto flex items-center justify-center shadow-xs">
            <CalendarClock className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-black text-navy-900">No AutoPay Mandates</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
              Set up recurring wallet payments for rent, subscriptions, or family allowances. They run automatically every month.
            </p>
          </div>
          <Button
            variant="primary"
            size="md"
            leftIcon={<PlusCircle className="w-4 h-4" />}
            onClick={() => setIsCreateOpen(true)}
            className="shadow-sm font-semibold"
          >
            Set up your first AutoPay
          </Button>
        </div>
      )}

      {/* Empty Filtered State */}
      {!isLoading && !loadError && mandates.length > 0 && filteredMandates.length === 0 && (
        <div className="p-10 text-center bg-white border border-slate-200/80 rounded-2xl max-w-sm mx-auto space-y-2">
          <p className="text-sm font-bold text-navy-900">No {activeTab.toLowerCase()} mandates</p>
          <p className="text-xs text-slate-500">
            There are currently no AutoPay mandates with status {activeTab}.
          </p>
        </div>
      )}

      {/* Mandate Cards Grid */}
      {!isLoading && !loadError && filteredMandates.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredMandates.map((mandate) => (
            <MandateCard
              key={mandate.id || mandate._id}
              mandate={mandate}
              onViewHistory={handleOpenHistory}
              onPause={handlePromptPause}
              onResume={handlePromptResume}
              onCancel={handlePromptCancel}
            />
          ))}
        </div>
      )}

      {/* Create Mandate Modal */}
      <CreateMandateModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSuccess={() => fetchMandates(false)}
      />

      {/* Execution History Dialog */}
      <MandateRunsDialog
        isOpen={!!selectedMandateForRuns}
        onClose={() => setSelectedMandateForRuns(null)}
        mandate={selectedMandateForRuns}
        runs={runs}
        isLoading={isRunsLoading}
        error={runsError}
      />

      {/* Confirmation Dialog (Pause, Resume, Cancel) */}
      <ConfirmActionDialog
        isOpen={actionDialog.isOpen}
        onClose={() => setActionDialog((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={handleExecuteAction}
        actionType={actionDialog.actionType}
        mandate={actionDialog.mandate}
        isLoading={actionDialog.isLoading}
      />
    </div>
  );
}

export default AutoPayPage;
