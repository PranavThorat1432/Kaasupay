import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight,
  ShieldCheck,
  Zap,
  RefreshCw,
  CheckCircle2,
  Lock,
  History,
  Landmark,
  KeyRound,
  Check,
  Sparkles,
  Smartphone,
  CheckCircle,
} from 'lucide-react';
import { useAuth } from '../store/hooks';
import Button from '../components/ui/Button';
import WalletCanvas from '../components/3d/WalletCanvas';

// Motion reveal variants for staggered animations
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.12,
      delayChildren: 0.08,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
  },
};

// Interactive Closing CTA with cursor-following ambient glow
function InteractiveCTA({ isAuthenticated }) {
  const ctaRef = useRef(null);
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e) => {
    if (!ctaRef.current) return;
    const rect = ctaRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setMousePos({ x, y });
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className="py-16 sm:py-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full my-6"
    >
      <div
        ref={ctaRef}
        onMouseMove={handleMouseMove}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="relative overflow-hidden rounded-3xl bg-linear-to-br from-navy-950 via-navy-900 to-cobalt-950 text-white p-8 sm:p-14 lg:p-16 text-center shadow-2xl border border-navy-800 transition-all duration-300"
      >
        {/* Dynamic Mouse-Following Radial Glow */}
        <div
          className="absolute inset-0 pointer-events-none transition-opacity duration-500 ease-out"
          style={{
            opacity: isHovered ? 0.75 : 0.3,
            background: `radial-gradient(650px circle at ${mousePos.x}% ${mousePos.y}%, rgba(37, 99, 235, 0.28), rgba(99, 102, 241, 0.12), transparent 70%)`,
          }}
        />

        {/* Ambient static corner glows */}
        <div className="absolute -top-24 -right-24 w-80 h-80 bg-cobalt-500/20 rounded-full blur-3xl pointer-events-none animate-pulse" />
        <div className="absolute -bottom-24 -left-24 w-80 h-80 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-2xl mx-auto flex flex-col gap-6 items-center">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            whileInView={{ scale: 1, opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1, duration: 0.4 }}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 text-cobalt-200 text-xs font-semibold backdrop-blur-md border border-white/15 shadow-inner"
          >
            <Sparkles className="w-3.5 h-3.5 text-cobalt-400" />
            <span>Free Personal Wallet • No Hidden Fees</span>
          </motion.div>

          <h3 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-white leading-tight">
            Ready for a digital wallet that simply works?
          </h3>

          <p className="text-sm sm:text-base text-slate-300 leading-relaxed font-normal max-w-lg">
            Create your account in less than a minute. Send money instantly to friends, top up anytime, and withdraw directly to your bank account with complete peace of mind.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 pt-4">
            {isAuthenticated ? (
              <Link to="/dashboard">
                <Button
                  variant="primary"
                  size="lg"
                  rightIcon={<ArrowRight className="w-4 h-4" />}
                  className="bg-cobalt-500 hover:bg-cobalt-600 text-white shadow-xl shadow-cobalt-600/30 font-semibold px-8 py-3.5 text-base"
                >
                  Go to Your Dashboard
                </Button>
              </Link>
            ) : (
              <>
                <Link to="/signup">
                  <Button
                    variant="primary"
                    size="lg"
                    rightIcon={<ArrowRight className="w-4 h-4" />}
                    className="bg-cobalt-500 hover:bg-cobalt-600 text-white shadow-xl shadow-cobalt-600/30 font-semibold px-8 py-3.5 text-base"
                  >
                    Open Your Free Wallet
                  </Button>
                </Link>
                <Link to="/signin">
                  <Button
                    variant="secondary"
                    size="lg"
                    className="bg-white/10 text-white border-white/20 hover:bg-white/20 hover:border-white/30 backdrop-blur-sm px-6 py-3.5 text-base"
                  >
                    Sign In to Account
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </motion.section>
  );
}

export function LandingPage() {
  const { isAuthenticated } = useAuth();
  const [activeStep, setActiveStep] = useState(1);

  const transferSteps = [
    {
      step: 1,
      title: '1. Select Recipient & Amount',
      tag: 'Step 1 of 3',
      description:
        'Search instantly by username or email. We verify their identity in real-time before you confirm.',
      example: 'To: Priya Sharma (@priya) • Amount: ₹500.00',
      benefit: 'No mistyped account numbers or lost money.',
    },
    {
      step: 2,
      title: '2. Authorize with Secret PIN',
      tag: 'Step 2 of 3',
      description:
        'Enter your personal 4-digit payment PIN. Transacting requires your secret PIN so only you can spend from your wallet.',
      example: 'PIN: • • • • (3 wrong tries pause access for 15 mins)',
      benefit: 'Unauthorized transfers are blocked before they happen.',
    },
    {
      step: 3,
      title: '3. Instant Transfer & Digital Receipt',
      tag: 'Step 3 of 3',
      description:
        'Money is moved instantly to the recipient with zero wait time. Both balances update together immediately.',
      example: 'Sent: ₹500.00 • Status: Success • Receipt #KP-9482',
      benefit: 'Instant settlement with a clear, permanent receipt.',
    },
  ];

  return (
    <div id="top" className="flex flex-col w-full selection:bg-cobalt-100 selection:text-cobalt-900">
      {/* =====================================================================
          1. HERO SECTION (Light-First, Animated Entrance, 3D Payment Card)
         ===================================================================== */}
      <section className="relative overflow-hidden pt-12 pb-20 sm:pt-20 sm:pb-28 px-4 sm:px-6 lg:px-8 border-b border-slate-200/90 bg-linear-to-b from-white via-slate-50/70 to-slate-100/50">
        <div className="absolute top-10 left-1/2 -translate-x-1/2 w-full max-w-6xl h-96 bg-radial from-cobalt-500/10 via-indigo-400/5 to-transparent blur-3xl pointer-events-none" />

        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center relative z-10">
          {/* Left Text Column */}
          <motion.div
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="lg:col-span-7 flex flex-col gap-6 text-left"
          >
            {/* Live Trust Pill */}
            <div className="inline-flex items-center gap-2 self-start px-3.5 py-1.5 rounded-full bg-cobalt-50 border border-cobalt-200/90 text-cobalt-800 text-xs font-bold tracking-wide shadow-xs">
              <span className="w-2 h-2 rounded-full bg-cobalt-600 animate-pulse" />
              <span>Simple, Secure Payments • Always Reliable</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-navy-950 tracking-tight leading-[1.12]">
              The smart, simple way to{' '}
              <span className="text-cobalt-600 underline decoration-cobalt-200 decoration-wavy decoration-2">
                manage your money.
              </span>
            </h1>

            <p className="text-base sm:text-lg text-slate-600 max-w-xl font-normal leading-relaxed">
              Send money instantly to anyone on KaasuPay, top up easily using UPI or cards, and withdraw directly to your bank account whenever you want. Fast, dependable, and completely transparent.
            </p>

            <div className="flex flex-wrap items-center gap-4 pt-2">
              {isAuthenticated ? (
                <Link to="/dashboard">
                  <Button variant="primary" size="lg" rightIcon={<ArrowRight className="w-4 h-4" />}>
                    Open Your Dashboard
                  </Button>
                </Link>
              ) : (
                <>
                  <Link to="/signup">
                    <Button variant="primary" size="lg" rightIcon={<ArrowRight className="w-4 h-4" />}>
                      Open Free Wallet
                    </Button>
                  </Link>
                  <a href="#how-it-works">
                    <Button variant="secondary" size="lg">
                      See How It Works
                    </Button>
                  </a>
                </>
              )}
            </div>

            {/* Genuine Value Indicators */}
            <div className="grid grid-cols-3 gap-4 pt-6 mt-2 border-t border-slate-200/80 text-xs">
              <div className="flex flex-col gap-0.5">
                <span className="font-black text-navy-950 text-sm sm:text-base">₹0 Fee</span>
                <span className="text-slate-500 font-medium">Free wallet transfers</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-black text-navy-950 text-sm sm:text-base">Instant</span>
                <span className="text-slate-500 font-medium">Direct wallet settlement</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-black text-navy-950 text-sm sm:text-base">Bank-Grade</span>
                <span className="text-slate-500 font-medium">Encrypted & secure</span>
              </div>
            </div>
          </motion.div>

          {/* Right 3D Payment Card Column */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.15, ease: 'easeOut' }}
            className="lg:col-span-5 flex items-center justify-center relative"
          >
            <div className="w-full max-w-md lg:max-w-lg">
              <WalletCanvas />
              <p className="text-[11px] text-slate-400 text-center mt-2 font-mono">
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* =====================================================================
          2. HOW IT WORKS (Scroll-linked 3-Step Interactive Payment Guide)
         ===================================================================== */}
      <motion.section
        id="how-it-works"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
        variants={containerVariants}
        className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full"
      >
        <motion.div variants={itemVariants} className="text-center max-w-2xl mx-auto mb-14">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cobalt-50 text-cobalt-700 text-xs font-bold uppercase tracking-wider mb-3 border border-cobalt-200">
            <Zap className="w-3.5 h-3.5" />
            Simple & Transparent
          </div>
          <h2 className="text-3xl sm:text-4xl font-black text-navy-950 tracking-tight">
            How sending money works
          </h2>
          <p className="text-sm sm:text-base text-slate-600 mt-2">
            Sending money on KaasuPay is designed to be effortless while keeping your funds completely secure.
          </p>
        </motion.div>

        <motion.div variants={itemVariants} className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Step Selector Pills */}
          <div className="lg:col-span-5 flex flex-col gap-3">
            {transferSteps.map((s) => (
              <button
                key={s.step}
                type="button"
                onClick={() => setActiveStep(s.step)}
                className={`w-full text-left p-5 rounded-2xl border transition-all duration-200 cursor-pointer flex flex-col gap-1.5 ${
                  activeStep === s.step
                    ? 'bg-white border-cobalt-600 shadow-md shadow-cobalt-600/10 ring-2 ring-cobalt-600/20'
                    : 'bg-white/70 border-slate-200 hover:border-slate-300 hover:bg-white'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-cobalt-600 uppercase tracking-wider">
                    {s.tag}
                  </span>
                  {activeStep === s.step && (
                    <span className="w-2 h-2 rounded-full bg-cobalt-600 animate-ping" />
                  )}
                </div>
                <h4 className="text-base font-bold text-navy-950">{s.title}</h4>
                <p className="text-xs text-slate-500 leading-relaxed">{s.description}</p>
              </button>
            ))}
          </div>

          {/* Interactive Step Preview Panel */}
          <div className="lg:col-span-7">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeStep}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.25 }}
                className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/90 shadow-lg shadow-slate-100 flex flex-col gap-6"
              >
                <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-cobalt-50 text-cobalt-600 flex items-center justify-center font-bold text-sm">
                      0{activeStep}
                    </div>
                    <div>
                      <h4 className="text-base font-bold text-navy-950">
                        {transferSteps[activeStep - 1].title}
                      </h4>
                      <span className="text-xs text-slate-500">Live Step Preview</span>
                    </div>
                  </div>
                  <span className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold flex items-center gap-1.5 border border-emerald-200">
                    <CheckCircle className="w-3.5 h-3.5" />
                    Verified Safe
                  </span>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 font-sans text-sm text-slate-700">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    What happens
                  </span>
                  <p className="font-medium text-navy-950">{transferSteps[activeStep - 1].example}</p>
                </div>

                <div className="flex items-start gap-3 p-4 rounded-2xl bg-cobalt-50/60 border border-cobalt-100 text-xs text-cobalt-950">
                  <ShieldCheck className="w-5 h-5 text-cobalt-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block">Why it matters</span>
                    <span className="text-cobalt-900 mt-0.5 block">
                      {transferSteps[activeStep - 1].benefit}
                    </span>
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
      </motion.section>

      {/* =====================================================================
          3. FEATURES BENTO GRID (Scroll-linked reveal, User-friendly copy)
         ===================================================================== */}
      <motion.section
        id="features"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.15 }}
        variants={containerVariants}
        className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full border-t border-slate-200/80"
      >
        <motion.div variants={itemVariants} className="text-center max-w-2xl mx-auto mb-14">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cobalt-50 text-cobalt-700 text-xs font-bold uppercase tracking-wider mb-3 border border-cobalt-200">
            <Sparkles className="w-3.5 h-3.5" />
            Designed For Trust
          </div>
          <h2 className="text-3xl sm:text-4xl font-black text-navy-950 tracking-tight">
            Built for reliability in every payment
          </h2>
          <p className="text-sm sm:text-base text-slate-600 mt-2">
            No complicated jargon. Just the features you need to send and receive money with complete confidence.
          </p>
        </motion.div>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Spotlight Card */}
          <motion.div
            variants={itemVariants}
            whileHover={{ y: -6, transition: { duration: 0.2 } }}
            className="md:col-span-2 p-8 rounded-3xl bg-linear-to-br from-white to-cobalt-50/40 border border-cobalt-100 shadow-sm flex flex-col justify-between gap-6"
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-cobalt-600 text-white flex items-center justify-center shadow-md shadow-cobalt-600/30">
                <Zap className="w-6 h-6" />
              </div>
              <div>
                <span className="text-xs font-bold text-cobalt-600 uppercase tracking-wider">
                  Guaranteed Accuracy
                </span>
                <h3 className="text-xl sm:text-2xl font-black text-navy-950 tracking-tight">
                  Both accounts update together. No money in limbo.
                </h3>
              </div>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed max-w-2xl">
              When you send money, your wallet is debited and your recipient is credited at the exact same instant. Transfers never hang half-done or get lost due to bad internet connection.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-200">
                <CheckCircle2 className="w-3.5 h-3.5" /> Instant delivery
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-cobalt-700 bg-cobalt-50 px-3 py-1.5 rounded-full border border-cobalt-200">
                <CheckCircle2 className="w-3.5 h-3.5" /> Exact balance tracking
              </span>
            </div>
          </motion.div>

          {/* Double-Tap Protection Card */}
          <motion.div
            variants={itemVariants}
            whileHover={{ y: -6, transition: { duration: 0.2 } }}
            className="p-8 rounded-3xl bg-white border border-slate-200/90 shadow-xs flex flex-col justify-between gap-6"
          >
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
              <RefreshCw className="w-6 h-6" />
            </div>
            <div>
              <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider">
                Double-Tap Safety
              </span>
              <h3 className="text-lg font-black text-navy-950 tracking-tight mt-1">
                Never pay twice by accident
              </h3>
              <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                If your screen freezes or you accidentally press send twice, our system recognizes the same request and processes it only once.
              </p>
            </div>
            <span className="text-[11px] font-bold text-slate-400">Automatic duplicate prevention</span>
          </motion.div>

          {/* Bank Withdrawals Card */}
          <motion.div
            variants={itemVariants}
            whileHover={{ y: -6, transition: { duration: 0.2 } }}
            className="p-8 rounded-3xl bg-white border border-slate-200/90 shadow-xs flex flex-col justify-between gap-6"
          >
            <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-100">
              <Landmark className="w-6 h-6" />
            </div>
            <div>
              <span className="text-xs font-bold text-amber-600 uppercase tracking-wider">
                Bank Payouts
              </span>
              <h3 className="text-lg font-black text-navy-950 tracking-tight mt-1">
                Withdraw straight to your bank
              </h3>
              <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                Link your savings or current bank account and transfer wallet balance back to your bank account anytime you want.
              </p>
            </div>
            <span className="text-[11px] font-bold text-slate-400">Direct account transfer</span>
          </motion.div>

          {/* Transparent Ledger History Card */}
          <motion.div
            variants={itemVariants}
            whileHover={{ y: -6, transition: { duration: 0.2 } }}
            className="md:col-span-2 p-8 rounded-3xl bg-white border border-slate-200/90 shadow-xs flex flex-col justify-between gap-6"
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100">
                <History className="w-6 h-6" />
              </div>
              <div>
                <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider">
                  Full Transparency
                </span>
                <h3 className="text-xl font-black text-navy-950 tracking-tight">
                  A complete, permanent record of every rupee
                </h3>
              </div>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              Every deposit, peer transfer, and withdrawal comes with accurate timestamps, recipient details, and a permanent transaction ID. What you see is always what happened.
            </p>
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              <Check className="w-4 h-4 text-emerald-600" />
              Clear credit and debit indicators on every transaction
            </div>
          </motion.div>
        </div>
      </motion.section>

      {/* =====================================================================
          4. SECURITY & PROTECTION SECTION (Genuine, User-friendly copy)
         ===================================================================== */}
      <motion.section
        id="guarantees"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.15 }}
        variants={containerVariants}
        className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full border-t border-slate-200/80 bg-slate-50/50 rounded-3xl my-6"
      >
        <motion.div variants={itemVariants} className="text-center max-w-2xl mx-auto mb-14">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold uppercase tracking-wider mb-3 border border-emerald-200">
            <Lock className="w-3.5 h-3.5" />
            Always Protected
          </div>
          <h2 className="text-3xl sm:text-4xl font-black text-navy-950 tracking-tight">
            Security controls built for your safety
          </h2>
          <p className="text-sm sm:text-base text-slate-600 mt-2">
            Clear, honest protections that safeguard your funds without unnecessary friction.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <motion.div
            variants={itemVariants}
            whileHover={{ y: -6, transition: { duration: 0.2 } }}
            className="p-6 rounded-3xl bg-white border border-slate-200/90 shadow-xs flex flex-col justify-between gap-4"
          >
            <div className="w-10 h-10 rounded-xl bg-cobalt-50 text-cobalt-600 flex items-center justify-center border border-cobalt-100">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-base font-bold text-navy-950 tracking-tight">4-Digit Payment PIN</h4>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                Every transfer requires your personal PIN. If someone guesses incorrectly 3 times, access is automatically paused for 15 minutes.
              </p>
            </div>
            <span className="text-[10px] font-bold text-slate-400">Lockout protection</span>
          </motion.div>

          <motion.div
            variants={itemVariants}
            whileHover={{ y: -6, transition: { duration: 0.2 } }}
            className="p-6 rounded-3xl bg-white border border-slate-200/90 shadow-xs flex flex-col justify-between gap-4"
          >
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-base font-bold text-navy-950 tracking-tight">₹10,000 Daily Limit</h4>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                A shared daily outgoing limit across transfers and withdrawals keeps your money secure. Resets automatically at 12:00 AM IST every day.
              </p>
            </div>
            <span className="text-[10px] font-bold text-slate-400">Daily spending cap</span>
          </motion.div>

          <motion.div
            variants={itemVariants}
            whileHover={{ y: -6, transition: { duration: 0.2 } }}
            className="p-6 rounded-3xl bg-white border border-slate-200/90 shadow-xs flex flex-col justify-between gap-4"
          >
            <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-base font-bold text-navy-950 tracking-tight">Encrypted Bank Details</h4>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                Bank account details are strongly encrypted. Only masked account numbers (showing the last 4 digits) are displayed on screen.
              </p>
            </div>
            <span className="text-[10px] font-bold text-slate-400">Private & masked</span>
          </motion.div>

          <motion.div
            variants={itemVariants}
            whileHover={{ y: -6, transition: { duration: 0.2 } }}
            className="p-6 rounded-3xl bg-white border border-slate-200/90 shadow-xs flex flex-col justify-between gap-4"
          >
            <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center border border-purple-100">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-base font-bold text-navy-950 tracking-tight">All-Device Sign Out</h4>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                Lost your phone or logged in on a public computer? Sign out of all active devices immediately with a single tap from your settings.
              </p>
            </div>
            <span className="text-[10px] font-bold text-slate-400">Instant session control</span>
          </motion.div>
        </div>
      </motion.section>

      {/* =====================================================================
          5. INTERACTIVE CLOSING CTA (Pointer-responsive radial glow)
         ===================================================================== */}
      <InteractiveCTA isAuthenticated={isAuthenticated} />
    </div>
  );
}

export default LandingPage;
