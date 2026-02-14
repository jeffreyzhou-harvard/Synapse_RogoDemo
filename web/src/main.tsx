import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import NewApp from './ui/NewApp';

const root = createRoot(document.getElementById('root')!);
root.render(<NewApp />);

