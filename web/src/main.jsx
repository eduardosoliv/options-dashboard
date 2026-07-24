import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element not found');
createRoot(rootEl).render(<App />);
