import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { installPrintLayout } from './print.js';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element not found');
installPrintLayout();
createRoot(rootEl).render(<App />);
