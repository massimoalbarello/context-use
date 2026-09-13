import '@fontsource-variable/dm-sans';
import { createRoot } from 'react-dom/client';
import { getPalette } from './palettes';
import { Playground } from './playground';
import './style.css';

const palette = getPalette(document.documentElement.dataset.palette);
createRoot(document.getElementById('root')!).render(<Playground palette={palette} />);
