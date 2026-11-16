import { render } from 'preact';
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-400-italic.css';   // the notes' italics, so <em> isn't a slanted upright
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow/latin-700.css';
import '@fontsource/barlow-semi-condensed/latin-500.css';
import '@fontsource/barlow-semi-condensed/latin-600.css';
import '@fontsource/barlow-semi-condensed/latin-700.css';
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/barlow-condensed/latin-800.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import { App } from './app/App';
import { watchInstall } from './lib/install';
import { progress } from './progress';

// iOS Safari applies :active (the pressed state) only when the page listens for touches.
document.addEventListener('touchstart', () => {}, { passive: true });

// Before the first render: Chrome may offer to install at any time after load, long before Settings opens.
watchInstall();

render(<App store={progress} />, document.getElementById('app')!);
