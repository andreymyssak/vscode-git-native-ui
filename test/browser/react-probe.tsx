import { createRoot } from 'react-dom/client';

import { CompilerProbe } from '../fixtures/CompilerProbe';
import first from './react-probe.module.css';
import second from './react-probe-other.module.css';

const root = document.getElementById('app');

if (!root) throw new Error('Probe root missing');
createRoot(root).render(
  <>
    <div className={first['local']} data-probe="first">
      First module
    </div>
    <div className={second['local']} data-probe="second">
      Second module
    </div>
    <CompilerProbe />
  </>,
);
