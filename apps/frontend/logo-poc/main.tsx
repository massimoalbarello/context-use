import '@fontsource-variable/dm-sans';
import { createRoot } from 'react-dom/client';
import { Playground } from './playground';
import './style.css';

createRoot(document.getElementById('root')!).render(<Playground />);
