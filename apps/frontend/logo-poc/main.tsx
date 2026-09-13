import '@fontsource-variable/dm-sans';
import { createRoot } from 'react-dom/client';
import { type LogoPalette, PALETTES } from '../src/components/brand/light/palettes';
import { Playground } from './playground';
import './style.css';

const name = document.documentElement.dataset.palette;
const palette: LogoPalette = name && Object.hasOwn(PALETTES, name) ? (name as LogoPalette) : 'sand';
createRoot(document.getElementById('root')!).render(<Playground palette={palette} />);
