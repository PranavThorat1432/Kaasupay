import { Link } from 'react-router-dom';
import { Home, Compass } from 'lucide-react';
import Button from '../components/ui/Button';

export function NotFoundPage() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 rounded-2xl bg-cobalt-50 text-cobalt-600 flex items-center justify-center mx-auto mb-6 border border-cobalt-100">
          <Compass className="w-8 h-8" />
        </div>
        <span className="text-xs font-bold uppercase tracking-widest text-cobalt-600">404 Error</span>
        <h1 className="text-3xl font-extrabold text-navy-950 tracking-tight mt-2 mb-3">
          Page Not Found
        </h1>
        <p className="text-xs text-slate-500 mb-8 leading-relaxed max-w-sm mx-auto">
          The requested path does not exist or has been relocated. Your wallet data is safe.
        </p>
        <Link to="/">
          <Button variant="primary" size="md" leftIcon={<Home className="w-4 h-4" />}>
            Return to Home
          </Button>
        </Link>
      </div>
    </div>
  );
}

export default NotFoundPage;
